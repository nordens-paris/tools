// How much of a parse was RNG? Compares a player's actual crits, avoided attacks
// (miss/dodge/parry/full resist) and, for spells, partial resists per ability with what the sim
// expects for that exact setup, and turns the difference into DPS. Positive = lucky.
// This is the direct part (the damage of the extra crits themselves); scenarios.ts adds the
// knock-on effects and proc luck by re-running the sim as if it had rolled like the player.
import type { LuckSummary } from '../../shared/types.ts';
import type { AbilityOutcome, PlayerFightRaw } from '../analysis/collect.ts';
import { spellName } from '../data/db.ts';
import type { SimPlayerMetrics } from './runner.ts';

interface SimRates {
  landed: number;
  crits: number;
  avoided: number;
  /** Direct hits only: damage done by resisted and unresisted hits, and how many of each. */
  resistedDmg: number;
  resistedHits: number;
  unresistedDmg: number;
  unresistedHits: number;
}

/** Share of the damage partial resists took off direct hits, 0..1. */
function simResistShare(r: SimRates): number {
  if (!r.resistedHits || !r.unresistedHits) return 0;
  // Resists and crits are rolled independently, so the averages compare like for like.
  const lostPerHit = r.unresistedDmg / r.unresistedHits - r.resistedDmg / r.resistedHits;
  const lost = lostPerHit * r.resistedHits;
  return lost / (r.resistedDmg + r.unresistedDmg + lost);
}

function simRatesByName(player: SimPlayerMetrics): Map<string, SimRates> {
  const rates = new Map<string, SimRates>();
  // Pets' and guardians' abilities are "Pet: <name>", like the log side (see collect.ts).
  const actions = [
    ...player.actions.map((a) => ({ a, prefix: '' })),
    ...(player.pets ?? []).flatMap((p) => p.actions.map((a) => ({ a, prefix: 'Pet: ' }))),
  ];
  for (const { a, prefix } of actions) {
    const isWhite = a.id.otherId === 'OtherActionAttack';
    // White MH/OH swings are "Melee" in the log; skip other attack tags (e.g. Windfury) here.
    if (isWhite && a.id.tag !== 1 && a.id.tag !== 2) continue;
    // The ranged auto attack (bow, gun) is "Auto Shot" in the log.
    const base = isWhite ? 'Melee' : a.id.otherId === 'OtherActionShoot' ? 'Auto Shot' : spellName(a.id.spellId ?? a.id.itemId ?? -1, '');
    if (!base) continue;
    const name = prefix + base;
    const r = rates.get(name) ?? { landed: 0, crits: 0, avoided: 0, resistedDmg: 0, resistedHits: 0, unresistedDmg: 0, unresistedHits: 0 };
    for (const t of a.targets) {
      // WoWSims "hits" excludes crits and glancing blows; resisted hits are a subset of hits/crits.
      r.landed += (t.hits ?? 0) + (t.crits ?? 0) + (t.glances ?? 0);
      r.crits += t.crits ?? 0;
      r.avoided += (t.misses ?? 0) + (t.dodges ?? 0) + (t.parries ?? 0);
      const resistedDirect = (t.resistedDamage ?? 0) - (t.resistedTickDamage ?? 0);
      const resistedHits = (t.resistedHits ?? 0) + (t.resistedCrits ?? 0);
      r.resistedDmg += resistedDirect;
      r.resistedHits += resistedHits;
      r.unresistedDmg += (t.damage ?? 0) - (t.tickDamage ?? 0) - resistedDirect;
      r.unresistedHits += (t.hits ?? 0) + (t.crits ?? 0) - resistedHits;
    }
    rates.set(name, r);
  }
  return rates;
}

/** Main- and off-hand hits of one ability (e.g. Whirlwind) are separate log entries; merge them. */
function mergeByName(outcomes: AbilityOutcome[]): AbilityOutcome[] {
  const byName = new Map<string, AbilityOutcome>();
  for (const o of outcomes) {
    const m = byName.get(o.name);
    if (!m) {
      byName.set(o.name, { ...o, resists: o.resists && { ...o.resists } });
      continue;
    }
    // Averages weighted by hit counts (normal hits = landed - crits).
    const normals = (x: AbilityOutcome) => Math.max(0, x.landed - x.crits);
    const wAvg = (a: number, wa: number, b: number, wb: number) => (wa + wb ? (a * wa + b * wb) / (wa + wb) : 0);
    m.normalAvg = wAvg(m.normalAvg, normals(m), o.normalAvg, normals(o));
    m.critAvg = wAvg(m.critAvg, m.crits, o.critAvg, o.crits);
    m.total += o.total;
    m.landed += o.landed;
    m.crits += o.crits;
    m.avoided += o.avoided;
    if (o.resists) m.resists = { resisted: (m.resists?.resisted ?? 0) + o.resists.resisted, potential: (m.resists?.potential ?? 0) + o.resists.potential };
  }
  // Several pets or guardians can share an ability name ("Pet: Melee"); the sim merges them too.
  return [...byName.values()];
}

/** Landed-weighted crit and avoid rates (0..100) the sim got on the named abilities. */
export function simRollRates(sim: SimPlayerMetrics, names: string[]): { critPct: number; avoidPct: number } {
  const rates = simRatesByName(sim);
  let landed = 0;
  let crits = 0;
  let avoided = 0;
  for (const name of names) {
    const r = rates.get(name);
    if (!r) continue;
    landed += r.landed;
    crits += r.crits;
    avoided += r.avoided;
  }
  return { critPct: landed ? (crits / landed) * 100 : 0, avoidPct: landed + avoided ? (avoided / (landed + avoided)) * 100 : 0 };
}

export interface DirectLuck {
  summary: LuckSummary;
  /** The player's own abilities the comparison used (not pets'), for measuring the sim's rates on the same set. */
  names: string[];
  critDps: number;
  avoidDps: number;
}

export function computeLuck(raw: PlayerFightRaw, sim: SimPlayerMetrics): DirectLuck {
  const rates = simRatesByName(sim);
  const totalDamage = raw.outcomes.reduce((s, o) => s + o.total, 0) || 1;
  let critExcess = 0;
  let critVariance = 0;
  let critsActual = 0;
  let critsExpected = 0;
  let landedAll = 0;
  let avoidActual = 0;
  let avoidExpected = 0;
  let attemptsAll = 0;
  let resistedActual = 0;
  let resistedExpected = 0;
  let resistPotential = 0;
  let luckDamage = 0;
  let critDamage = 0;
  let avoidDamage = 0;
  const names: string[] = [];
  const abilities: LuckSummary['abilities'] = [];

  for (const o of mergeByName(raw.outcomes)) {
    const r = rates.get(o.name);
    // Only abilities that matter and that the sim also used.
    // DoT-only abilities (Curse of Doom...) have no direct hits to roll crits or misses on.
    if (!r || r.landed < 1 || o.landed < 1 || o.total / totalDamage < 0.02) continue;
    const pCrit = r.crits / r.landed;
    const pAvoid = r.avoided / (r.landed + r.avoided);
    const attempts = o.landed + o.avoided;

    const expCrits = o.landed * pCrit;
    const expAvoid = attempts * pAvoid;
    const avgLanded = o.landed ? o.total / o.landed : 0;
    // Extra damage per extra crit: crit average minus normal average when the log has both,
    // otherwise assume crits do double damage.
    const perCrit = o.critAvg && o.normalAvg ? o.critAvg - o.normalAvg : avgLanded / (1 + pCrit);
    const dmgFromCrits = (o.crits - expCrits) * perCrit;
    const dmgFromAvoid = (expAvoid - o.avoided) * avgLanded;
    // Partial resists (spells): damage the sim expects resists to take off vs what they took.
    const resistShare = simResistShare(r);
    const expResisted = o.resists ? o.resists.potential * resistShare : 0;
    const dmgFromResists = o.resists ? expResisted - o.resists.resisted : 0;
    const dmgFromLuck = dmgFromCrits + dmgFromAvoid + dmgFromResists;
    abilities.push({
      name: o.name,
      critPct: o.landed ? (o.crits / o.landed) * 100 : 0,
      expectedCritPct: pCrit * 100,
      avoidPct: attempts ? (o.avoided / attempts) * 100 : 0,
      expectedAvoidPct: pAvoid * 100,
      ...(o.resists?.potential
        ? { resistPct: (o.resists.resisted / o.resists.potential) * 100, expectedResistPct: resistShare * 100 }
        : {}),
      luckDps: dmgFromLuck / raw.fight.durationSec,
    });
    luckDamage += dmgFromLuck;
    // A pet's rolls come from its own stats, so they count as luck but not towards the player's crit
    // and hit (which the knock-on sim re-rolls with the player's rating).
    if (o.pet) continue;

    critExcess += o.crits - expCrits;
    critVariance += o.landed * pCrit * (1 - pCrit);
    critsActual += o.crits;
    critsExpected += expCrits;
    landedAll += o.landed;
    avoidActual += o.avoided;
    avoidExpected += expAvoid;
    attemptsAll += attempts;
    resistedActual += o.resists?.resisted ?? 0;
    resistedExpected += expResisted;
    resistPotential += o.resists?.potential ?? 0;
    critDamage += dmgFromCrits;
    avoidDamage += dmgFromAvoid;
    names.push(o.name);
  }

  const luckDps = luckDamage / raw.fight.durationSec;
  const summary: LuckSummary = {
    luckDps,
    directDps: luckDps,
    luckPct: raw.fight.simComparableDps ? (luckDps / raw.fight.simComparableDps) * 100 : 0,
    critPct: landedAll ? (critsActual / landedAll) * 100 : 0,
    expectedCritPct: landedAll ? (critsExpected / landedAll) * 100 : 0,
    critZ: critVariance ? critExcess / Math.sqrt(critVariance) : 0,
    avoidPct: attemptsAll ? (avoidActual / attemptsAll) * 100 : 0,
    expectedAvoidPct: attemptsAll ? (avoidExpected / attemptsAll) * 100 : 0,
    ...(resistPotential
      ? {
          resistPct: (resistedActual / resistPotential) * 100,
          expectedResistPct: (resistedExpected / resistPotential) * 100,
          resistLuckDps: (resistedExpected - resistedActual) / raw.fight.durationSec,
        }
      : {}),
    abilities: abilities.sort((a, b) => Math.abs(b.luckDps) - Math.abs(a.luckDps)),
    knockOnDps: 0,
    procLuckDps: 0,
    procs: [],
  };
  return { summary, names, critDps: critDamage / raw.fight.durationSec, avoidDps: avoidDamage / raw.fight.durationSec };
}
