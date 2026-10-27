// Tank sims: each tank (you and the peers) simmed with their own gear, talents and raid buffs from
// the log, tanking the boss with the WoWSims tank rotation. Threat over the kill and the opener next
// to what they did shows how much of their gear's threat they got out; the peers' median cancels
// any sim offset, like the DPS execution. Your own gear is then swapped for the peers' to show the
// threat and damage-taken trade-off.
//
// The boss swings like it did in your raid (sim/request.ts BossMelee): the median time between its
// swings on your raid's main tank, and its average hit before armor, turned back into WoWSims'
// numbers: hit = minBaseDamage × (1.25 + 0.00052 × attack power) on average (core/attack.go
// EnemyWeaponDamage with a 0.5 damage spread), with the boss's 320 attack power lowered by
// Demoralizing Shout (300) as much as it was up, and Thunder Clap's 10% slower attacks taken out
// of the swing time. WoWSims then applies its own debuffs: the warrior and bear rotations keep
// Demoralizing Shout/Roar and Thunder Clap up themselves.
import type { TankSimPlayer, TankSimResult, TankSimScenario } from '../../shared/types.ts';
import { collectPlayerFight, type PlayerFightRaw } from '../analysis/collect.ts';
import type { StoredTank, TankSimInput } from '../analysis/tank/compare.ts';
import { median } from '../analysis/stats.ts';
import { tankSimSpecs } from '../specs/tank-sim.ts';
import type { WclClient } from '../wcl/client.ts';
import { buildRequest, encounterOf, environmentOf, setupFromRaw, unknownItems, type BossMelee, type SimPlayerSetup } from './request.ts';
import type { SimEnvironment } from './environment.ts';
import { CLI_PARALLEL, limited, type SimRun } from './scenarios.ts';

/** The opener window the sims are run for, as in the tank metrics. */
const OPENER_SEC = 10;
/**
 * Iterations per tank sim, at most: averages of threat and damage taken settle much faster than a
 * DPS sim's luck analysis needs, and a tank sim (boss swinging, parries, blocks) is slower to run.
 */
const MAX_ITERATIONS = 1000;
const BOSS_AP = 320;
const AP_COEFFICIENT = 0.00052;
const DEMO_SHOUT_AP = 300;
const THUNDER_CLAP_SLOW = 1.1;
const REGULAR = 'TristateEffectRegular';

const uptime = (raw: PlayerFightRaw, names: string[]) => Math.max(0, ...raw.fight.bossDebuffs.filter((d) => names.includes(d.name)).map((d) => d.uptimePct / 100));
const DEMO = ['Demoralizing Shout', 'Demoralizing Roar'];
const THUNDER_CLAP = ['Thunder Clap'];

/** The boss in WoWSims' numbers, from your raid's main tank's swings (see the top of the file). */
function bossFrom(boss: NonNullable<TankSimInput['boss']>, yours: PlayerFightRaw): BossMelee {
  const ap = Math.max(0, BOSS_AP - DEMO_SHOUT_AP * uptime(yours, DEMO));
  const slow = 1 + (THUNDER_CLAP_SLOW - 1) * uptime(yours, THUNDER_CLAP);
  // Dual wield: each weapon swings half as often as the boss does overall.
  return {
    swingSpeed: (boss.swingGapSec * (boss.dualWield ? 2 : 1)) / slow,
    dualWield: boss.dualWield,
    minBaseDamage: boss.hitBeforeArmor / (1.25 + AP_COEFFICIENT * ap),
  };
}

/**
 * The raid's debuffs on the boss, plus Demoralizing Shout and Thunder Clap when someone else kept
 * them up (a paladin's rotation has neither; warriors and bears apply their own).
 */
function tankEnvironment(raw: PlayerFightRaw, className: string): SimEnvironment {
  const env = structuredClone(environmentOf(raw, tankSimSpecs[className]));
  if (className !== 'Warrior' && className !== 'Druid' && uptime(raw, DEMO) >= 0.5) {
    env.debuffs.demoralizingShout = REGULAR;
    env.detected.push('Demoralizing Shout');
  }
  if (className !== 'Warrior' && uptime(raw, THUNDER_CLAP) >= 0.5) {
    env.debuffs.thunderClap = REGULAR;
    env.detected.push('Thunder Clap');
  }
  return env;
}

async function collect(client: WclClient, className: string, p: TankSimInput['players'][number]): Promise<PlayerFightRaw> {
  const fights = await client.fights(p.report);
  const source = p.you ? p.metrics.source : fights.friendlies.find((a) => a.name === p.name && a.fights.some((f) => f.id === p.fight))?.id;
  if (source === undefined) throw new Error(`${p.name} not found in their report`);
  return collectPlayerFight(client, tankSimSpecs[className], p.report, p.fight, source, { server: p.server, region: p.region });
}

export async function runTankSims(
  stored: StoredTank,
  client: WclClient,
  run: SimRun,
  iterations: number,
  log: (msg: string) => void = () => {},
  // How many sims may run at once (CPU cores here, or browser workers).
  parallel = CLI_PARALLEL,
): Promise<TankSimResult> {
  const { analysis, simInput } = stored;
  iterations = Math.min(iterations, MAX_ITERATIONS);
  const { className } = simInput;
  const spec = tankSimSpecs[className];
  if (!spec) throw new Error(`No tank sim for ${className}`);
  if (!simInput.boss) throw new Error('Not enough of the boss’s swings on one tank in your raid to set up the boss for the sims.');

  log(`Collecting gear and buffs for ${simInput.players.length} tanks`);
  const warnings: string[] = [];
  const raws = await Promise.all(
    simInput.players.map((p) =>
      collect(client, className, p).catch((err) => {
        warnings.push(`Skipped ${p.name}: ${(err as Error).message}`);
        return undefined;
      }),
    ),
  );
  const yours = raws[0];
  if (!yours?.combatant?.gear?.length) throw new Error('Your gear isn’t in the log (combatant info missing), so there is nothing to sim.');
  const boss = bossFrom(simInput.boss, yours);

  const runLimited = limited(run, parallel);
  const sim = (player: SimPlayerSetup, raw: PlayerFightRaw, durationSec: number) =>
    runLimited(buildRequest({ spec, player, env: tankEnvironment(raw, className), durationSec, encounter: encounterOf(raw), iterations, tank: boss }));
  const out = (r: Awaited<ReturnType<SimRun>>) => ({ tps: r.player.threat?.avg ?? 0, dtps: r.player.dtps?.avg ?? 0 });

  // Each tank's own setup over their kill and over the opener.
  const players = simInput.players
    .map((p, i) => ({ p, raw: raws[i] }))
    .filter((x): x is { p: (typeof x)['p']; raw: PlayerFightRaw } => !!x.raw?.combatant?.gear?.length);
  for (const x of simInput.players.filter((_, i) => raws[i] && !raws[i]!.combatant?.gear?.length)) warnings.push(`Skipped ${x.name}: no gear in their log`);
  log(`Simming ${players.length} tanks, their openers and your gear swaps`);
  const own = players.map(({ p, raw }) => Promise.all([sim(setupFromRaw(raw, spec), raw, p.durationSec), sim(setupFromRaw(raw, spec), raw, OPENER_SEC)]));

  // Your setup with a peer's gear: the most survivable and the highest-threat peer.
  const peerRaws = players.filter((x) => !x.p.you);
  const pick = (score: (x: (typeof peerRaws)[number]) => number) => peerRaws.slice().sort((a, b) => score(b) - score(a))[0];
  const sturdiest = pick((x) => x.p.metrics.survivability.effectiveHealth);
  const strongest = pick((x) => x.p.metrics.threat.onTanked);
  const swaps = [
    sturdiest && { key: 'gear-ehp', label: `${sturdiest.p.name}'s gear`, description: `The peer with the most effective health (${Math.round(sturdiest.p.metrics.survivability.effectiveHealth / 1000)}k), with your talents, consumes and buffs.`, x: sturdiest },
    strongest && strongest !== sturdiest && { key: 'gear-tps', label: `${strongest.p.name}'s gear`, description: `The peer with the most threat on the boss (${Math.round(strongest.p.metrics.threat.onTanked)} TPS), with your talents, consumes and buffs.`, x: strongest },
  ].filter((s): s is Exclude<typeof s, false | undefined> => !!s);
  const yourSetup = setupFromRaw(yours, spec);
  const swapSims = swaps.map((s) => {
    const setup = { ...yourSetup, gear: s.x.raw.combatant!.gear };
    return Promise.all([sim(setup, yours, simInput.players[0].durationSec), sim(setup, yours, OPENER_SEC)]);
  });

  const [ownResults, swapResults] = await Promise.all([Promise.all(own), Promise.all(swapSims)]);
  const rows: TankSimPlayer[] = players.map(({ p }, i) => {
    const [full, opener] = ownResults[i].map(out);
    const actualOpener = p.metrics.opener.threat / p.metrics.opener.windowSec;
    return {
      name: p.name,
      ...(p.you ? { you: true } : {}),
      role: p.metrics.role,
      swingShare: p.metrics.swingShare,
      actualTps: p.metrics.threat.onTanked,
      simTps: full.tps,
      threatPct: full.tps ? (p.metrics.threat.onTanked / full.tps) * 100 : 0,
      relativePct: 0,
      actualOpenerTps: actualOpener,
      simOpenerTps: opener.tps,
      openerPct: opener.tps ? (actualOpener / opener.tps) * 100 : 0,
      // While tanking: an off-tank takes the boss's swings only part of the kill.
      actualDtps: p.metrics.swingShare > 0.05 ? p.metrics.meleeDtps / Math.min(1, p.metrics.swingShare) : p.metrics.meleeDtps,
      simDtps: full.dtps,
    };
  });
  const peerMedian = (get: (r: TankSimPlayer) => number) => {
    const vals = rows.filter((r) => !r.you && get(r) > 0).map(get);
    return vals.length ? median(vals) : 0;
  };
  const threatMedian = peerMedian((r) => r.threatPct);
  for (const r of rows) r.relativePct = threatMedian ? (r.threatPct / threatMedian) * 100 : 0;

  const [base, baseOpener] = ownResults[0].map(out);
  const scenarios: TankSimScenario[] = [
    { key: 'baseline', label: 'Your setup', description: 'Your gear, talents, consumes and raid buffs from the log, tanking the boss for your kill time.', tps: base.tps, dtps: base.dtps, openerTps: baseOpener.tps, deltaTps: 0, deltaDtps: 0 },
    ...swaps.map((s, i) => {
      const [full, opener] = swapResults[i].map(out);
      return { key: s.key, label: s.label, description: s.description, changes: gearChanges(yours, s.x.raw), tps: full.tps, dtps: full.dtps, openerTps: opener.tps, deltaTps: full.tps - base.tps, deltaDtps: full.dtps - base.dtps };
    }),
  ];

  return {
    kind: 'tank',
    analysisId: analysis.id,
    iterations,
    boss: { from: simInput.boss.from, swingSpeed: boss.swingSpeed, swingGapSec: simInput.boss.swingGapSec, dualWield: boss.dualWield, minBaseDamage: boss.minBaseDamage, hitBeforeArmor: simInput.boss.hitBeforeArmor },
    scenarios,
    players: rows,
    notes: [
      `The boss swings ${boss.dualWield ? 'two weapons, each' : ''} every ${boss.swingSpeed.toFixed(2)} s before slows and hits for ${Math.round(simInput.boss.hitBeforeArmor)} on average before armor, as it did on ${simInput.boss.from} in your raid. Only its melee is simmed, not its other abilities.`.replace('  ', ' '),
      `Raid buffs detected for you: ${tankEnvironment(yours, className).detected.join(', ') || 'none'}.`,
      `Your talents: ${yours.fight.talentSource === 'armory' ? 'from the armory' : 'the WoWSims preset (armory spec not found)'} (${yours.fight.talents}).`,
      ...spec.sim.notes,
      'Threat counts damage and abilities on the boss (WoWSims’ values, as on the Threat tab), not healing or rage. The sim tanks the boss the whole kill; off-tanks are compared with peers in the same role, where that cancels out.',
      'Simmed damage taken is the boss’s melee only, with no healing. The log’s is its melee on you per second while you tanked it (your melee taken ÷ your share of its swings).',
      ...players
        .map(({ p, raw }) => ({ name: p.name, ids: unknownItems(raw.combatant!.gear) }))
        .filter((x) => x.ids.length)
        .map((x) => `Left out of ${x.name}'s sim (not in WoWSims): ${x.ids.map((id) => raws.flatMap((r) => r?.fight.gear ?? []).find((g) => g.id === id)?.name ?? `item ${id}`).join(', ')}.`),
    ],
    warnings,
  };
}

/** Slots where the two players' items differ. */
function gearChanges(you: PlayerFightRaw, other: PlayerFightRaw): string[] {
  const byId = new Map(you.fight.gear.map((g) => [g.slot, g.name]));
  return other.fight.gear.filter((g) => byId.get(g.slot) !== g.name).map((g) => `${g.slot}: ${byId.get(g.slot) ?? 'empty'} → ${g.name}`);
}
