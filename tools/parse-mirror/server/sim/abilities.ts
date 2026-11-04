// Per-ability real vs simmed DPS of one player's own setup, for "Play by ability"
// (shared/dpsGap.ts playByAbility). Names are matched as the luck analysis does (luck.ts): the
// log's boss-only outcomes merged by name, the sim's actions under the log's names, "Pet: " for
// pets and guardians. Damage that doesn't match by name ends up in the table's "Other" row.
import type { AbilityPlay, LuckSummary } from '../../shared/types.ts';
import type { PlayerFightRaw } from '../analysis/collect.ts';
import { mergeByName, simRatesByName } from './luck.ts';
import type { SimPlayerMetrics } from './runner.ts';

export function abilityRows(raw: PlayerFightRaw, sim: SimPlayerMetrics, iterations: number, luck: LuckSummary): AbilityPlay[] {
  const sec = raw.fight.durationSec;
  if (!sec || !iterations) return [];
  const rates = simRatesByName(sim, true);
  const outcomes = new Map(mergeByName(raw.outcomes).map((o) => [o.name, o]));
  const casts = new Map(raw.fight.casts.map((c) => [c.name, c.casts]));
  // Icons from casts, else from the damage table (Melee, poisons and procs have no casts).
  const icons = new Map([...raw.outcomes.filter((o) => o.icon).map((o) => [o.name, o.icon] as const), ...raw.fight.casts.map((c) => [c.name, c.icon] as const)]);
  const luckOf = new Map(luck.abilities.map((a) => [a.name, a.luckDps]));
  const names = new Set([...outcomes.keys(), ...[...rates].filter(([, r]) => r.damage > 0).map(([name]) => name)]);

  const rows: AbilityPlay[] = [];
  for (const name of names) {
    const o = outcomes.get(name);
    const r = rates.get(name);
    const realDps = (o?.total ?? 0) / sec;
    const simDps = (r?.damage ?? 0) / iterations / sec;
    if (realDps <= 0 && simDps <= 0) continue;
    // Casts where either side has them (DoTs: the casts, not the ticks; Stormstrike and Seal of
    // Command count their real cast, spec.castIds); a spell only one side cast counts 0 on the other.
    // Melee, procs and pet attacks have no casts: compare hits and misses (swings) instead.
    const logCasts = casts.get(name);
    const byHits = !r?.casts && !(logCasts && !r);
    rows.push({
      name,
      realDps,
      simDps,
      casts: byHits ? (o ? o.landed + o.avoided : 0) : (logCasts ?? 0),
      simCasts: (byHits ? (r ? r.landed + r.avoided : 0) : (r?.casts ?? 0)) / iterations,
      ...(byHits ? { byHits: true } : {}),
      luckDps: luckOf.get(name) ?? 0,
      ...(icons.get(name) ? { icon: icons.get(name) } : {}),
    });
  }
  return rows.sort((a, b) => b.realDps + b.simDps - (a.realDps + a.simDps));
}
