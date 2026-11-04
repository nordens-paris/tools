// Dev helper: a whole analysis plus every sim, printed: scenarios with their changes, and each
// player's execution split (gear & buffs, kill time, play, luck vs you), the ± ranges and Play by ability.
// Usage: npx tsx --env-file=.env scripts/full-run.ts <report> <fight> <source> [top|peers] [iterations]
import { analyze } from '../server/analysis/analyze.ts';
import { gapNoise, gapParts, NOISE_Z, playByAbility, simScale } from '../shared/dpsGap.ts';
import { runSim } from '../server/sim/runner.ts';
import { runScenarios } from '../server/sim/scenarios.ts';
import { WclClient } from '../server/wcl/client.ts';

const [report, fight, source, mode = 'top', iters = '3000'] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const stored = await analyze(client, report, Number(fight), Number(source), () => {}, mode as 'top' | 'peers');
const r = stored.result;
console.log('Hit:', r.metrics.summary.find((m) => m.key === 'hit'));
console.log('PI:', [r.you, ...r.top].filter((p) => p.powerInfusion).map((p) => `${p.name} ${p.powerInfusion!.uses}x +${Math.round(p.powerInfusion!.dps)}`));
console.log('Eff:', r.metrics.efficiency.map((m) => `${m.label} you ${m.you.toFixed(0)} median ${m.median.toFixed(0)}`));
for (const f of r.findings) console.log(`[${f.severity}] ${f.title}: ${f.detail}`);
const started = Date.now();
const sim = await runScenarios(stored, (req) => runSim(process.env.WOWSIMS_CLI!, req), Number(iters), () => {});
console.log(`Sims took ${((Date.now() - started) / 1000).toFixed(1)} s`);
for (const s of sim.scenarios) {
  const pm = s.deltaSe !== undefined ? ` ± ${(NOISE_Z * s.deltaSe).toFixed(1)}` : '';
  console.log(`${s.label}: ${s.dps.toFixed(0)} (${s.deltaVsBaseline >= 0 ? '+' : ''}${s.deltaVsBaseline.toFixed(0)}${pm})`, s.changes ?? '');
}
const you = sim.execution.find((e) => !e.rank)!;
const k = simScale(sim.execution);
console.log(`Sim scale (top median real − luck / sim): ${(k * 100).toFixed(1)}%`);
console.log('rank name        kill  real   sim  simYou  exec%  noLuck%  | gear  kill  play  luck');
for (const e of [...sim.execution].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))) {
  const on = e.simDpsOnYourTime ?? e.simDps;
  const parts = Object.values(gapParts(e, you, k)).map((v) => v.toFixed(0).padStart(5));
  console.log(
    `${String(e.rank ?? 'you').padEnd(4)} ${e.name.padEnd(11)} ${String(Math.round(e.durationSec ?? 0)).padStart(4)} ${e.actualDps.toFixed(0).padStart(5)} ${e.simDps.toFixed(0).padStart(5)} ${on.toFixed(0).padStart(6)}  ${e.relativePct.toFixed(1).padStart(5)}  ${e.luckAdjustedPct.toFixed(1).padStart(6)}  | ${parts.join(' ')}`,
  );
}

const others = sim.execution.filter((e) => e.rank);
const noise = gapNoise(sim.execution, you);
for (const part of ['gear', 'kill', 'play', 'luck'] as const) {
  const avg = others.reduce((s, e) => s + gapParts(e, you, k)[part], 0) / others.length;
  console.log(`${part.padEnd(5)} ${avg.toFixed(0).padStart(6)} ± ${noise.parts[part].half.toFixed(0)}`);
}
const l = you.luck;
console.log(`Your luck ${l.luckDps.toFixed(0)} (crit SD ${l.critSeDps?.toFixed(0)}, avoid SD ${l.avoidSeDps?.toFixed(0)}, estimate SE ${l.estimateSeDps?.toFixed(1)})`);
console.log('Sim noise (simSe/gearSe/killSe):', sim.execution.map((e) => `${e.name} ${e.noise?.simSe.toFixed(1)}/${e.noise?.gearSe?.toFixed(1)}/${e.noise?.killSe?.toFixed(1)}`).join(', '));
const table = playByAbility(sim.execution, you, k);
if (table) {
  const n = (v: number | undefined, w: number, d = 0) => (v === undefined ? '–' : v.toFixed(d)).padStart(w);
  console.log('ability             /min   sim   top | per cast    sim | cast% top%  dmg% top%  play  group   gap');
  for (const r of table.rows) {
    console.log(
      `${(r.name + (r.byHits ? '*' : '')).padEnd(18)} ${n(r.perMinute, 5, 1)} ${n(r.simPerMinute, 5, 1)} ${n(r.groupPerMinute, 5, 1)} | ${n(r.perCast, 8)} ${n(r.simPerCast, 6)} | ${n(r.castsPct && r.castsPct * 100, 5)} ${n(r.groupCastsPct && r.groupCastsPct * 100, 5)} ${n(r.perCastPct && r.perCastPct * 100, 5)} ${n(r.groupPerCastPct && r.groupPerCastPct * 100, 5)} ${n(r.play, 5)} ${n(r.groupPlay, 6)} ${n(r.gap, 5)}`,
    );
  }
  console.log(`${('Other: ' + table.other.names.join(', ')).slice(0, 73).padEnd(73)} ${n(table.other.play, 5)} ${n(table.other.groupPlay, 6)} ${n(table.other.gap, 5)}`);
  console.log(`${'Play (tile)'.padEnd(73)} ${n(table.total.play, 5)} ${n(table.total.groupPlay, 6)} ${n(table.total.gap, 5)}`);
}
