// Dev helper: a whole analysis plus every sim, printed: scenarios with their changes, and each
// player's execution split (gear & buffs, kill time, play, luck vs you).
// Usage: npx tsx --env-file=.env scripts/full-run.ts <report> <fight> <source> [top|peers] [iterations]
import { analyze } from '../server/analysis/analyze.ts';
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
for (const s of sim.scenarios) console.log(`${s.label}: ${s.dps.toFixed(0)} (${s.deltaVsBaseline >= 0 ? '+' : ''}${s.deltaVsBaseline.toFixed(0)})`, s.changes ?? '');
const you = sim.execution.find((e) => !e.rank)!;
const play = (e: typeof you) => e.actualDps - e.luck.luckDps - e.simDps;
console.log('rank name        kill  real   sim  simYou  exec%  noLuck%  | gear  kill  play  luck');
for (const e of [...sim.execution].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))) {
  const on = e.simDpsOnYourTime ?? e.simDps;
  const parts = [on - you.simDps, e.simDps - on, play(e) - play(you), e.luck.luckDps - you.luck.luckDps].map((v) => v.toFixed(0).padStart(5));
  console.log(
    `${String(e.rank ?? 'you').padEnd(4)} ${e.name.padEnd(11)} ${String(Math.round(e.durationSec ?? 0)).padStart(4)} ${e.actualDps.toFixed(0).padStart(5)} ${e.simDps.toFixed(0).padStart(5)} ${on.toFixed(0).padStart(6)}  ${e.relativePct.toFixed(1).padStart(5)}  ${e.luckAdjustedPct.toFixed(1).padStart(6)}  | ${parts.join(' ')}`,
  );
}
