// Checks a spec's sim setup against real kills: sims the top ranked players of the spec on each boss
// and reports how much of their simmed DPS they got (execution), before and after luck. A good
// setup puts most top players at 95-105% of their sim (after luck) with a small spread; a high or
// low median, or a wide spread, points at something the sim gets wrong for this spec.
//
//   npx tsx --env-file=.env scripts/validate-spec.ts <spec-key> <encounterId...> [--n=10] [--iterations=500] [--ids]
//
// --ids adds each player's <report> <fight> <source>, for scripts/exec-breakdown.ts.
// Encounter IDs are Warcraft Logs' (Anniversary: 50601 Naj'entus ... 50622 Archimonde). Also lists
// what the sim can't see for the spec: abilities in the log the sim never used, gear WoWSims doesn't
// have, and weapon enchants or consumes that aren't mapped.
import { collectTopPlayers, topCandidates } from '../server/analysis/analyze.ts';
import type { PlayerFightRaw } from '../server/analysis/collect.ts';
import { median } from '../server/analysis/stats.ts';
import { computeLuck } from '../server/sim/luck.ts';
import { buildRequest, encounterOf, environmentOf, setupFromRaw, unknownItems } from '../server/sim/request.ts';
import { runSim } from '../server/sim/runner.ts';
import { CLI_PARALLEL, limited } from '../server/sim/scenarios.ts';
import { specs } from '../server/specs/index.ts';
import { WclClient } from '../server/wcl/client.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const [key, ...rest] = args.filter((a) => !a.startsWith('--'));
const spec = specs.find((s) => s.key === key);
if (!spec || !rest.length) {
  console.error(`Usage: validate-spec.ts <spec-key> <encounterId...> [--n=10] [--iterations=500]\nSpecs: ${specs.map((s) => s.key).join(', ')}`);
  process.exit(1);
}
const n = flag('n', 10);
const iterations = flag('iterations', 500);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const cli = process.env.WOWSIMS_CLI!;
const sim = limited((raw: PlayerFightRaw) => {
  const request = buildRequest({ spec, player: setupFromRaw(raw, spec), env: environmentOf(raw, spec), durationSec: raw.fight.durationSec, encounter: encounterOf(raw), iterations });
  return runSim(cli, request);
}, CLI_PARALLEL);

const pct = (v: number) => `${v.toFixed(1)}%`.padStart(7);
const quartiles = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
  return { q1: at(0.25), q3: at(0.75) };
};

/**
 * Abilities with 2%+ of a player's damage that the luck analysis couldn't match to the sim: the sim
 * never used them, or names them differently. Damage-over-time-only abilities (Mind Flay ticks) have
 * no direct hits to compare, and damage the sim can't model is expected to be missing.
 */
function absentFromSim(raw: PlayerFightRaw, matched: string[]) {
  const total = raw.outcomes.reduce((sum, o) => sum + o.total, 0) || 1;
  return raw.outcomes.filter((o) => o.total / total >= 0.02 && o.landed > 0 && !matched.includes(o.name) && !spec!.sim.unmodeledDamage?.includes(o.name));
}

const allExec: number[] = [];
const allAdj: number[] = [];
const missing = new Map<string, { players: number; sharePct: number[] }>();
const unknownGear = new Map<number, number>();
const unmapped = new Map<string, number>();

for (const encounterId of rest.map(Number)) {
  const warnings: string[] = [];
  const top = (await collectTopPlayers(client, spec, (await topCandidates(client, spec, encounterId)).candidates, n, undefined, warnings)).filter((t) => t.combatant);
  console.log(`\n${top[0]?.encounterName ?? encounterId}: ${top.length} players${warnings.length ? ` (${warnings.length} skipped)` : ''}`);
  console.log('  rank  player                 log DPS   sim DPS     exec  luck-adj   pet  notes');
  const rows = await Promise.all(
    top.map(async (raw) => {
      const s = await sim(raw);
      const luck = computeLuck(raw, s.player);
      const actual = raw.fight.simComparableDps;
      const exec = (actual / s.avg) * 100;
      const adj = ((actual - luck.summary.luckDps) / s.avg) * 100;
      // Abilities with a real share of the damage that the sim never used (or names differently).
      const total = raw.outcomes.reduce((sum, o) => sum + o.total, 0) || 1;
      for (const o of absentFromSim(raw, luck.summary.abilities.map((a) => a.name))) {
        const m = missing.get(o.name) ?? { players: 0, sharePct: [] };
        m.players++;
        m.sharePct.push((o.total / total) * 100);
        missing.set(o.name, m);
      }
      for (const id of unknownItems(raw.combatant?.gear ?? [])) unknownGear.set(id, (unknownGear.get(id) ?? 0) + 1);
      for (const c of raw.consumes.list.filter((c) => /^Unknown/.test(c.name))) unmapped.set(`${c.category}: ${c.name}`, (unmapped.get(`${c.category}: ${c.name}`) ?? 0) + 1);
      return { raw, s, exec, adj };
    }),
  );
  for (const { raw, s, exec, adj } of rows) {
    allExec.push(exec);
    allAdj.push(adj);
    const pet = (raw.fight.pets ?? []).filter((p) => p.kind === 'pet').reduce((sum, p) => sum + p.sharePct, 0);
    const total = raw.outcomes.reduce((sum, o) => sum + o.total, 0) || 1;
    const absent = absentFromSim(raw, computeLuck(raw, s.player).summary.abilities.map((a) => a.name)).map((o) => o.name);
    const notes = [
      raw.fight.talentSource === 'preset' ? 'preset talents' : '',
      unknownItems(raw.combatant?.gear ?? []).length ? 'unknown gear' : '',
      absent.length ? `not in sim: ${absent.join(', ')}` : '',
      args.includes('--ids') ? `${raw.fight.report} ${raw.fight.fight} ${raw.fight.source}` : '',
    ].filter(Boolean).join(', ');
    console.log(
      `  ${String(raw.fight.rank ?? '').padStart(4)}  ${raw.fight.name.slice(0, 20).padEnd(20)} ${raw.fight.simComparableDps.toFixed(0).padStart(9)} ${s.avg.toFixed(0).padStart(9)} ${pct(exec)} ${pct(adj)}  ${pet ? `${pet.toFixed(0)}%`.padStart(4) : '   -'}  ${notes}`,
    );
  }
}

if (allExec.length) {
  const e = quartiles(allExec);
  const a = quartiles(allAdj);
  console.log(`\n${spec.specName} ${spec.className}, ${allExec.length} players`);
  console.log(`  execution       median ${pct(median(allExec))}   middle half ${e.q1.toFixed(1)}-${e.q3.toFixed(1)}%`);
  console.log(`  after luck      median ${pct(median(allAdj))}   middle half ${a.q1.toFixed(1)}-${a.q3.toFixed(1)}%`);
  const ok = median(allAdj) >= 90 && median(allAdj) <= 105 && a.q3 - a.q1 <= 12;
  console.log(`  ${ok ? 'OK' : 'CHECK'}: top players should land at about 90-105% of their sim after luck, with the middle half within ~12 points.`);
}
if (missing.size) {
  console.log('\nIn the log but not in the sim (2%+ of a player\'s damage):');
  for (const [name, m] of [...missing].sort((x, y) => y[1].players - x[1].players)) console.log(`  ${name.padEnd(28)} ${m.players} players, median ${median(m.sharePct).toFixed(1)}% of damage`);
}
if (unknownGear.size) console.log(`\nGear WoWSims doesn't have (left out of sims): ${[...unknownGear].map(([id, c]) => `${id} ×${c}`).join(', ')}`);
if (unmapped.size) console.log(`\nWeapon enchants/consumes not mapped: ${[...unmapped].map(([k, c]) => `${k} ×${c}`).join(', ')}`);
