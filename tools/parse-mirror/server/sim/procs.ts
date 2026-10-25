// Proc luck: trinkets, weapon enchants and set bonuses that proc on hit or cast were up more or
// less in the log than the sim expects. Their stats, weighted by the uptime difference, go back
// into a sim to see what that luck was worth.
import type { LuckSummary } from '../../shared/types.ts';
import type { PlayerFightRaw } from '../analysis/collect.ts';
import { loadJson, spellName } from '../data/db.ts';
import type { SimPlayerMetrics } from './runner.ts';

type Stats = Record<string, number>;

// Item procs come from the WoWSims database (scripts/extract-wowsims-data.mjs). Enchant and set
// bonus procs aren't in it; these are the common DPS ones, with WoWSims stat indexes.
const EXTRA: Record<number, { item: string; stats: Stats }> = {
  // Mongoose: 120 agility and 2% attack speed (about 31.5 haste rating).
  28093: { item: 'Mongoose', stats: { 1: 120, 22: 31.5 } },
  42976: { item: 'Executioner', stats: { 23: 840 } },
  20007: { item: 'Crusader', stats: { 0: 100 } },
  // Voidheart Raiment 2-piece.
  37379: { item: 'Voidheart Raiment 2-piece', stats: { 11: 135 } },
  37378: { item: 'Voidheart Raiment 2-piece', stats: { 7: 135 } },
};

let table: Record<number, { item: string; stats: Stats }> | undefined;
function procTable() {
  table ??= { ...loadJson<Record<number, { item: string; stats: Stats }>>('procs.json'), ...EXTRA };
  return table;
}

export interface ProcLuck {
  procs: LuckSummary['procs'];
  /** Stats to add to the sim (WoWSims index -> value) to give it the player's proc luck. */
  bonusStats: Record<number, number>;
}

/** Proc uptimes in the log vs the sim, for procs both of them track. */
export function procLuck(raw: PlayerFightRaw, sim: SimPlayerMetrics): ProcLuck {
  const known = procTable();
  const dur = raw.fight.durationSec;
  // Two copies of a proc (Mongoose on both weapons) are separate auras in the sim but merge into
  // one buff in the log in a way we can't undo, so those are left out.
  const simUptimes = new Map<number, number[]>();
  for (const a of sim.auras) {
    const id = a.id.spellId;
    if (!id || !known[id] || !a.uptimeSecondsAvg) continue;
    simUptimes.set(id, [...(simUptimes.get(id) ?? []), Math.min(1, a.uptimeSecondsAvg / dur)]);
  }
  const procs: LuckSummary['procs'] = [];
  const bonusStats: Record<number, number> = {};
  for (const [id, ups] of simUptimes) {
    const logged = raw.fight.buffs.find((b) => b.id === id);
    if (!logged || ups.length !== 1) continue;
    const expected = ups[0] * 100;
    const diff = logged.uptimePct - expected;
    procs.push({ name: spellName(id, logged.name), item: known[id].item, uptimePct: logged.uptimePct, expectedUptimePct: expected });
    for (const [stat, value] of Object.entries(known[id].stats)) {
      bonusStats[Number(stat)] = (bonusStats[Number(stat)] ?? 0) + (value * diff) / 100;
    }
  }
  return { procs: procs.sort((a, b) => Math.abs(b.uptimePct - b.expectedUptimePct) - Math.abs(a.uptimePct - a.expectedUptimePct)), bonusStats };
}
