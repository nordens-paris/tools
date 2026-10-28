// "What if" sims: the player's own setup, then swapping in what the top players had.
import os from 'node:os';

import type { ConsumeUse, LuckSummary, SimPlayerResult, SimResult, SimScenarioResult } from '../../shared/types.ts';
import type { StoredAnalysis } from '../analysis/analyze.ts';
import { WCL_SLOTS, type PlayerFightRaw } from '../analysis/collect.ts';
import { itemInfo } from '../data/db.ts';
import { median, mostCommon } from '../analysis/stats.ts';

import { bossArmor, buildRequest, encounterOf, environmentOf, raidAurasOf, setupFromRaw, type SimPlayerSetup } from './request.ts';
import { buildEnvironment, withConsumablesFrom, withTopRaidBuffs, type SimEnvironment } from './environment.ts';
import { computeLuck, simRollRates } from './luck.ts';
import { procLuck } from './procs.ts';
import type { SimDps } from './runner.ts';

/** Runs one WoWSims request: the command line tool on this machine, or a browser (browser.ts). */
export type SimRun = (request: unknown) => Promise<SimDps>;

// Rating per 1% crit / hit at level 70, and the WoWSims stat indexes they go in.
const ROLL_STATS = {
  melee: { crit: { stat: 21, perPct: 22.08 }, hit: { stat: 20, perPct: 15.77 } },
  caster: { crit: { stat: 13, perPct: 22.08 }, hit: { stat: 12, perPct: 12.62 } },
};
// The command line tool spreads each sim's iterations over every core, but processes still
// overlap their start-up and output, so a few run side by side. SIM_PARALLEL overrides it.
export const CLI_PARALLEL = Number(process.env.SIM_PARALLEL) || Math.max(1, Math.min(8, os.cpus().length - 1));

/** Wraps an async function so at most `limit` calls run at once; the rest wait in call order. */
export function limited<A, T>(fn: (arg: A) => Promise<T>, limit: number): (arg: A) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (arg) => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await fn(arg);
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

export async function runScenarios(
  stored: StoredAnalysis,
  run: SimRun,
  iterations: number,
  log: (msg: string) => void = () => {},
  // How many sims may run at once (CPU cores here, or browser workers).
  parallel = CLI_PARALLEL,
): Promise<SimResult> {
  const { spec, you, top } = stored;
  const group = stored.result.comparison;
  const durationSec = you.fight.durationSec;
  const encounter = encounterOf(you);
  const envOf = (raw: PlayerFightRaw) => environmentOf(raw, spec);

  const yourSetup = setupFromRaw(you, spec);
  const yourEnv = envOf(you);
  const best = top.find((t) => t.combatant);
  const topConsumes = popularConsumes(top);
  const consumes = upgradeConsumes(you, topConsumes, popularFlags(top));
  const topConsumeSources = top.map((t) => ({ buffs: t.fight.buffs, drums: t.consumes.drums, durationSec: t.fight.durationSec }));
  const consumeEnv = withConsumablesFrom(yourEnv, topConsumeSources, durationSec);
  // Drums and smokes are in both lists; keep the consume list's line for those.
  const consumeEnvChanges = consumeEnv.detected
    .filter((d) => !yourEnv.detected.includes(d))
    .map((d) => d.replace(/ \(top 10(, )?/, ' (').replace(' ()', ''))
    .filter((d) => !consumes.changes.some((c) => c.includes(d.replace(/ \(.*\)$/, ''))))
    .map((d) => `Consumable buff: + ${d}`);
  // Top players' raid buffs with your own consumable buffs (Power Core...), so only raid setup differs.
  const raidBuffs = withTopRaidBuffs(
    yourEnv,
    // Their own class buffs (Trueshot Aura...) are left out, as for you: your sim gives you yours.
    top.map((t) => {
      const auras = raidAurasOf(t, spec);
      return buildEnvironment(auras.buffs, auras.bossDebuffs, undefined, { consumableBuffs: you.fight.buffs, isbHitPct: t.fight.isbHitPct, shadowPriestDps: t.fight.partyShadowPriestDps });
    }),
  );

  // Every sim shares one limit, and all of them are queued as soon as they can run: the scenarios
  // and each player's own sim right away, luck and kill-time sims once that player's sim is back.
  // Results don't depend on the order (every sim has a fixed seed).
  const runLimited = limited(run, parallel);
  const sim = (player: SimPlayerSetup, env = yourEnv, duration = durationSec) =>
    runLimited(buildRequest({ spec, player, env, durationSec: duration, encounter, iterations }));

  const scenarios: { key: string; label: string; description: string; changes?: string[]; player: SimPlayerSetup; env?: SimEnvironment }[] = [
    {
      key: 'baseline',
      label: 'Your setup',
      description: 'Your gear, consumes and raid buffs from the log, on your kill time.',
      player: yourSetup,
    },
    {
      key: 'consumes',
      label: `${group.short} consumes`,
      description: `Your gear, with the consumes most ${group.players} used added or swapped in. Consumes you used that they skip are kept.`,
      changes: [...consumes.changes, ...consumeEnvChanges],
      player: { ...yourSetup, consumes: consumes.list, flags: consumes.flags, conjuredId: consumes.conjuredId },
      // Drums and stat-buff consumables like Power Core are applied through the environment.
      env: consumeEnv,
    },
    {
      key: 'buffs',
      label: `${group.short} raid buffs`,
      description: `Your gear and consumes, plus the raid buffs and boss debuffs most ${group.players} had that you were missing. Shows how much is raid setup rather than you.`,
      changes: raidBuffs.added,
      player: yourSetup,
      env: raidBuffs.env,
    },
  ];
  if (best) {
    scenarios.push(
      {
        key: 'gear',
        label: `Rank ${best.fight.rank} gear`,
        description: `${best.fight.name}'s gear (avg ilvl ${best.fight.avgItemLevel.toFixed(1)}) with your consumes and buffs.`,
        changes: gearChanges(you, best),
        player: { ...yourSetup, gear: best.combatant!.gear },
      },
      {
        key: 'all',
        label: 'All of the above',
        description: `${best.fight.name}'s gear, plus the ${group.short.toLowerCase()} consumes and raid buffs, together.`,
        player: { ...yourSetup, consumes: consumes.list, flags: consumes.flags, conjuredId: consumes.conjuredId, gear: best.combatant!.gear },
        env: withConsumablesFrom(raidBuffs.env, topConsumeSources, durationSec),
      },
    );
  }

  const players = [you, ...top].filter((raw) => raw.combatant);
  log(`Simming ${scenarios.length} scenarios, and execution and luck for ${players.length} players`);
  const baseline = sim(yourSetup);
  // Players' own sims go first: their luck sims can only start once those are back.
  const ownSims = new Map(players.map((raw) => [raw, raw === you ? baseline : sim(setupFromRaw(raw, spec), envOf(raw), raw.fight.durationSec)]));
  const scenarioPromise = Promise.all(scenarios.map((s, i) => (i === 0 ? baseline : sim(s.player, s.env))));

  // Execution: actual DPS vs what the sim says each player's own setup can do on their own kill
  // time, with luck worked out against that same setup.
  const executionPromise = Promise.all(
    players.map(async (raw): Promise<SimPlayerResult> => {
      const setup = setupFromRaw(raw, spec);
      const env = envOf(raw);
      const own = await ownSims.get(raw)!;
      // The same setup on your kill time splits "setup" into gear and buffs vs kill length.
      const [luck, onYourTime] = await Promise.all([
        luckOf(raw, own, spec.caster, (bonus) => sim(setup, withBonusStats(env, bonus), raw.fight.durationSec)),
        raw === you ? own : sim(setup, env, durationSec),
      ]);
      return {
        name: raw.fight.name,
        rank: raw.fight.rank,
        actualDps: raw.fight.simComparableDps,
        simDps: own.avg,
        simDpsOnYourTime: onYourTime.avg,
        durationSec: raw.fight.durationSec,
        executionPct: own.avg ? (raw.fight.simComparableDps / own.avg) * 100 : 0,
        relativePct: 0,
        luck,
        luckAdjustedPct: own.avg ? ((raw.fight.simComparableDps - luck.luckDps) / own.avg) * 100 : 0,
      };
    }),
  );
  const [scenarioSims, execution] = await Promise.all([scenarioPromise, executionPromise]);
  const baselineSim = scenarioSims[0];
  const results: SimScenarioResult[] = scenarios.map((s, i) => ({
    key: s.key,
    label: s.label,
    description: s.description,
    changes: s.changes,
    dps: scenarioSims[i].avg,
    stdev: scenarioSims[i].stdev,
    deltaVsBaseline: scenarioSims[i].avg - baselineSim.avg,
  }));

  // Any systematic sim offset affects everyone equally; comparing against the top players'
  // median cancels it out. Same for the luck-adjusted version.
  const topMedian = median(execution.filter((e) => e.rank).map((e) => e.executionPct));
  const topMedianAdj = median(execution.filter((e) => e.rank).map((e) => e.luckAdjustedPct));
  for (const e of execution) {
    e.relativePct = topMedian ? (e.executionPct / topMedian) * 100 : 0;
    e.luckAdjustedPct = topMedianAdj ? (e.luckAdjustedPct / topMedianAdj) * 100 : 0;
  }

  return {
    analysisId: stored.result.id,
    iterations,
    knockOn: spec.sim.knockOn,
    scenarios: results,
    execution,
    notes: [
      `Raid buffs detected for you: ${yourEnv.detected.join(', ') || 'none'}.`,
      `Your talents: ${you.fight.talentSource === 'armory' ? 'from the armory' : 'standard build (armory spec not found)'} (${you.fight.talents}).`,
      ...spec.sim.notes,
      `Boss armor ${bossArmor(encounter.id)}; execute phase ${Math.round((encounter.executeProportion ?? 0.2) * 100)}% of the fight${encounter.executeProportion ? ' (from your first Execute)' : ' (assumed)'}.`,
      "No crit adjustment: the sim's crit matches real kills on average. Ranked parses are each player's best kill out of many, so they usually rolled well; the luck columns show how much.",
      'Luck includes knock-on effects: each player is simmed again with crit and hit set to what they actually rolled, and again with their trinket and enchant procs up as long as they were in the log.',
    ],
  };
}

function withBonusStats(env: SimEnvironment, bonus: Record<number, number>): SimEnvironment {
  const out = structuredClone(env);
  for (const [idx, value] of Object.entries(bonus)) out.bonusStats[Number(idx)] = (out.bonusStats[Number(idx)] ?? 0) + value;
  return out;
}

/**
 * Luck in three parts. Direct: the damage of the extra or missing crits, hits and resists.
 * Knock-on: the sim again with crit and hit rating set so it rolls like the player did, which also
 * counts what those rolls feed (rage and Flurry for warriors, the player's own Improved Shadow Bolt
 * procs...). Procs: the sim again with trinket/enchant proc stats for the extra (or missing) uptime.
 */
async function luckOf(
  raw: PlayerFightRaw,
  base: SimDps,
  caster: boolean,
  simWith: (bonus: Record<number, number>) => Promise<SimDps>,
): Promise<LuckSummary> {
  const direct = computeLuck(raw, base.player);
  const summary = direct.summary;
  const roll = ROLL_STATS[caster ? 'caster' : 'melee'];
  const critGap = summary.critPct - summary.expectedCritPct;
  const avoidGap = summary.expectedAvoidPct - summary.avoidPct;
  const procs = procLuck(raw, base.player);

  const [rolled, procced] = await Promise.all([
    // Small gaps are within the sims' own noise; the direct estimate is better there.
    Math.abs(critGap) >= 0.5 || Math.abs(avoidGap) >= 0.5
      ? simWith({ [roll.crit.stat]: critGap * roll.crit.perPct, [roll.hit.stat]: avoidGap * roll.hit.perPct })
      : undefined,
    Object.keys(procs.bonusStats).length ? simWith(procs.bonusStats) : undefined,
  ]);

  const directRolls = direct.critDps + direct.avoidDps;
  let rollDps = directRolls;
  if (rolled) {
    // Rating can't push past caps (spell hit, crit vs. glancing blows), so check how much of each
    // gap the sim reproduced and add the direct value of the part it couldn't.
    const before = simRollRates(base.player, direct.names);
    const after = simRollRates(rolled.player, direct.names);
    const share = (got: number, wanted: number) => (Math.abs(wanted) < 0.5 ? 1 : Math.min(1, Math.max(0, got / wanted)));
    const critShare = share(after.critPct - before.critPct, critGap);
    const avoidShare = share(before.avoidPct - after.avoidPct, avoidGap);
    const simmed = rolled.avg - base.avg + direct.critDps * (1 - critShare) + direct.avoidDps * (1 - avoidShare);
    // Knock-on effects point the same way as the rolls that cause them; if not, it's sim noise.
    if (Math.sign(simmed) === Math.sign(directRolls) || Math.abs(directRolls) < 5) rollDps = simmed;
  }
  const knockOnDps = rollDps - directRolls;
  const procLuckDps = procced ? procced.avg - base.avg : 0;
  const luckDps = summary.directDps + knockOnDps + procLuckDps;
  return {
    ...summary,
    luckDps,
    luckPct: raw.fight.simComparableDps ? (luckDps / raw.fight.simComparableDps) * 100 : 0,
    knockOnDps,
    procLuckDps,
    procs: procs.procs,
  };
}

/**
 * Your consumes with the top players' choices swapped in per category (and their engineering
 * items/scrolls added). Categories they don't use keep yours, so the sim only gains.
 */
const ELIXIRS: ConsumeUse['category'][] = ['Battle Elixir', 'Guardian Elixir'];

function upgradeConsumes(you: PlayerFightRaw, top: ConsumeUse[], flags: Pick<SimPlayerSetup, 'flags' | 'conjuredId'>) {
  let list = [...you.consumes.list];
  const changes: string[] = [];
  // A flask can't be combined with battle or guardian elixirs: switching one way drops the other.
  const topFlask = top.find((c) => c.category === 'Flask');
  const topElixirs = top.filter((c) => ELIXIRS.includes(c.category));
  const myFlask = list.find((c) => c.category === 'Flask');
  const myElixirs = list.filter((c) => ELIXIRS.includes(c.category));
  if (topFlask && myElixirs.length && !myFlask) {
    changes.push(`Elixirs: ${myElixirs.map((c) => c.name).join(' + ')} → ${topFlask.name}`);
    list = [...list.filter((c) => !ELIXIRS.includes(c.category)), topFlask];
  } else if (topElixirs.length && myFlask) {
    changes.push(`Flask: ${myFlask.name} → ${topElixirs.map((c) => c.name).join(' + ')}`);
    list = [...list.filter((c) => c !== myFlask), ...topElixirs.filter((c) => !list.some((x) => x.name === c.name))];
  }
  for (const c of top) {
    if (list.some((x) => x.name === c.name)) continue;
    if (c.category === 'Flask' && list.some((x) => ELIXIRS.includes(x.category))) continue;
    if (ELIXIRS.includes(c.category) && list.some((x) => x.category === 'Flask')) continue;
    // ID-based consumes replace yours in the same category; flag-based ones (sappers, scrolls) add.
    const i = c.simId ? list.findIndex((x) => x.category === c.category && x.simId) : -1;
    changes.push(i >= 0 ? `${c.category}: ${list[i].name} → ${c.name}` : `${c.category}: + ${c.name}`);
    if (i >= 0) list[i] = c;
    else list.push(c);
  }
  const merged = { ...you.consumes.flags };
  for (const [k, v] of Object.entries(flags.flags ?? {})) if (v) merged[k as keyof typeof merged] = true;
  if (!you.consumes.conjuredId && flags.conjuredId) {
    const name = flags.conjuredId === 12662 ? 'Demonic/Dark Rune' : flags.conjuredId === 22788 ? 'Flame Cap' : `item ${flags.conjuredId}`;
    if (!changes.some((c) => c.includes(name))) changes.push(`Conjured: + ${name}`);
  }
  return { list, changes, flags: merged, conjuredId: you.consumes.conjuredId ?? flags.conjuredId };
}

/** Slots where the rank 1 player's item differs from yours. */
function gearChanges(you: PlayerFightRaw, best: PlayerFightRaw): string[] {
  const name = (id?: number) => (id ? (itemInfo(id)?.n ?? `Item ${id}`) : 'empty');
  return Object.entries(WCL_SLOTS).flatMap(([idx, slot]) => {
    const mine = you.combatant?.gear[Number(idx)]?.id;
    const theirs = best.combatant?.gear[Number(idx)]?.id;
    return mine === theirs ? [] : [`${slot}: ${name(mine)} → ${name(theirs)}`];
  });
}

/** For each consume category most top players used, the most common choice that WoWSims can sim. */
function popularConsumes(top: PlayerFightRaw[]): ConsumeUse[] {
  const out: ConsumeUse[] = [];
  const categories = new Set(top.flatMap((t) => t.consumes.list.map((c) => c.category)));
  for (const cat of categories) {
    const playersWith = top.filter((t) => t.consumes.list.some((c) => c.category === cat)).length;
    if (playersWith < top.length / 2) continue;
    // Flask or elixirs, whichever more of them used (they don't combine).
    const flasked = top.filter((t) => t.consumes.list.some((c) => c.category === 'Flask')).length;
    const elixired = top.filter((t) => t.consumes.list.some((c) => ELIXIRS.includes(c.category))).length;
    if (cat === 'Flask' && elixired > flasked) continue;
    if (ELIXIRS.includes(cat) && flasked >= elixired) continue;
    // Flag-based consumes (scrolls, sappers...) are all listed; ID-based ones pick the most common.
    const uses = top.flatMap((t) => t.consumes.list.filter((c) => c.category === cat && c.simulated));
    const byId = uses.filter((c) => c.simId);
    if (byId.length) out.push(mostCommon(byId, (c) => c.name)!);
    for (const c of uses.filter((u) => !u.simId)) {
      if (!out.some((o) => o.name === c.name) && top.filter((t) => t.consumes.list.some((x) => x.name === c.name)).length >= top.length / 2) {
        out.push(c);
      }
    }
  }
  return out;
}

function popularFlags(top: PlayerFightRaw[]): Pick<SimPlayerSetup, 'flags' | 'conjuredId'> {
  const half = top.length / 2;
  const flags: SimPlayerSetup['flags'] = {};
  for (const key of new Set(top.flatMap((t) => Object.keys(t.consumes.flags)))) {
    const k = key as keyof SimPlayerSetup['flags'];
    flags[k] = top.filter((t) => t.consumes.flags[k]).length >= half;
  }
  const conjured = mostCommon(top.map((t) => t.consumes.conjuredId).filter((c): c is number => !!c));
  const conjuredUsers = top.filter((t) => t.consumes.conjuredId).length;
  return { flags, conjuredId: conjuredUsers >= half ? conjured : undefined };
}
