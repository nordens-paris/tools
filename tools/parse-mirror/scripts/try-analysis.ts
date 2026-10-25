// Dev helper: runs analysis + sims from the command line.
// Usage: npx tsx --env-file=.env scripts/try-analysis.ts <report> <fight> <source> [--sim] [--dump file.json]
import fs from 'node:fs';
import { analyze } from '../server/analysis/analyze.ts';
import { buildRequest, encounterOf, environmentOf, setupFromRaw } from '../server/sim/request.ts';
import { runSim } from '../server/sim/runner.ts';
import { runScenarios } from '../server/sim/scenarios.ts';
import { WclClient } from '../server/wcl/client.ts';

const [report, fight, source] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const stored = await analyze(client, report, Number(fight), Number(source), console.log);
fs.mkdirSync('.cache', { recursive: true });
fs.writeFileSync('.cache/last-analysis.json', JSON.stringify(stored.result, null, 2));
const r = stored.result;
console.log(`\n${r.you.name}: ${r.you.dps.toFixed(0)} DPS, ${r.you.durationSec}s, race ${r.you.race}, split ${r.you.talentSplit.join('/')}`);
console.log('Top:', r.top.map((t) => `#${t.rank} ${t.name} ${t.dps.toFixed(0)} (${t.durationSec.toFixed(0)}s)`).join(', '));
console.log('\nConsumes:', r.you.consumes.map((c) => `${c.category}: ${c.name}${c.simulated ? '' : ' (not simmed)'}`).join('; '));
for (const group of Object.values(r.metrics)) for (const m of group) console.log(`  ${m.label.padEnd(32)} you ${m.you.toFixed(1).padStart(7)}  median ${m.median.toFixed(1).padStart(7)}  [${m.min.toFixed(1)}-${m.max.toFixed(1)}]`);
console.log('\nFindings:');
for (const f of r.findings) console.log(`  [${f.severity}] ${f.area}: ${f.title} — ${f.detail}`);
console.log('\nWarnings:', r.warnings);
const dumpAt = process.argv.indexOf('--dump');
if (dumpAt > 0) {
  // Writes the baseline WoWSims request, for running the CLI by hand.
  const env = environmentOf(stored.you, stored.spec);
  const req = buildRequest({
    spec: stored.spec,
    player: setupFromRaw(stored.you, stored.spec),
    env,
    durationSec: stored.you.fight.durationSec,
    encounter: encounterOf(stored.you),
    iterations: 1000,
  });
  fs.writeFileSync(process.argv[dumpAt + 1], JSON.stringify(req, null, 1));
}
if (process.argv.includes('--sim')) {
  const sim = await runScenarios(stored, (req) => runSim(process.env.WOWSIMS_CLI!, req), Number(process.env.SIM_ITERATIONS ?? 3000), console.log);
  fs.writeFileSync('.cache/last-sim.json', JSON.stringify(sim, null, 2));
  for (const s of sim.scenarios) console.log(`  ${s.label.padEnd(26)} ${s.dps.toFixed(0)} (${s.deltaVsBaseline >= 0 ? '+' : ''}${s.deltaVsBaseline.toFixed(0)})`);
  for (const e of sim.execution) console.log(`  ${(e.rank ? '#' + e.rank + ' ' : '') + e.name}: actual ${e.actualDps.toFixed(0)} sim ${e.simDps.toFixed(0)} = ${e.executionPct.toFixed(0)}%`);
  console.log(sim.notes.join('\n'));
}
if (process.argv.includes('--sim')) {
  const last = JSON.parse(fs.readFileSync('.cache/last-sim.json', 'utf8'));
  console.log('\nLuck:');
  for (const e of last.execution) {
    const l = e.luck;
    console.log(`  ${(e.rank ? '#' + e.rank + ' ' : 'You ') + e.name}: crit ${l.critPct.toFixed(1)}% vs ${l.expectedCritPct.toFixed(1)}% (z ${l.critZ.toFixed(1)}), avoided ${l.avoidPct.toFixed(1)}% vs ${l.expectedAvoidPct.toFixed(1)}%, ${l.resistPct !== undefined ? `resisted ${l.resistPct.toFixed(1)}% vs ${l.expectedResistPct!.toFixed(1)}% (${l.resistLuckDps!.toFixed(0)} DPS), ` : ""}luck ${l.luckDps.toFixed(0)} DPS (${l.luckPct.toFixed(1)}%), exec ${e.relativePct.toFixed(0)}% -> ${e.luckAdjustedPct.toFixed(0)}% without luck`);
  }
}
