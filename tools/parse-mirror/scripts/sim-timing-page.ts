// Times every sim behind one DPS page (scenarios, each player's own sim, luck and kill-time sims),
// one at a time, and prints the slowest with what they simmed.
// Usage: npx tsx --env-file=.env scripts/sim-timing-page.ts <report> <fight> <source> [iterations]
import { analyze } from '../server/analysis/analyze.ts';
import { runSim } from '../server/sim/runner.ts';
import { runScenarios } from '../server/sim/scenarios.ts';
import { WclClient } from '../server/wcl/client.ts';

const [report, fight, source, iters = '1000'] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const stored = await analyze(client, report, Number(fight), Number(source), () => {}, 'top');
type Req = { raid: { parties: { players: { name?: string; equipment?: unknown }[] }[] }; encounter: { duration: number } };
const times: { ms: number; name: string; duration: number }[] = [];
const started = Date.now();
await runScenarios(
  stored,
  async (req) => {
    const t0 = performance.now();
    const r = await runSim(process.env.WOWSIMS_CLI!, req);
    const q = req as Req;
    times.push({ ms: performance.now() - t0, name: q.raid.parties[0].players[0].name ?? '?', duration: q.encounter.duration });
    return r;
  },
  Number(iters),
  () => {},
  1,
);
const total = times.reduce((s, t) => s + t.ms, 0);
console.log(`${stored.result.you.name} ${stored.spec.key}: ${times.length} sims, ${(total / 1000).toFixed(1)} s in sims (${((Date.now() - started) / 1000).toFixed(1)} s wall), ${(total / times.length).toFixed(0)} ms per sim`);
for (const t of [...times].sort((a, b) => b.ms - a.ms).slice(0, 5)) console.log(`  ${t.ms.toFixed(0)} ms  ${t.name}  ${t.duration.toFixed(0)} s`);
