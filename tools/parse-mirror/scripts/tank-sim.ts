// Dev helper: the tank sims for one tank with the WoWSims command line tool (WOWSIMS_CLI).
// Usage: npx tsx --env-file=.env scripts/tank-sim.ts <report>:<fight> <tank name> [iterations]
import { analyzeTank } from '../server/analysis/tank/compare.ts';
import { runSim } from '../server/sim/runner.ts';
import { runTankSims } from '../server/sim/tank.ts';
import { WclClient } from '../server/wcl/client.ts';

const [target, name, iterations = '1000'] = process.argv.slice(2);
const [report, fight] = target.split(':');
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const actor = (await client.fights(report)).friendlies.find((a) => a.name === name);
if (!actor) throw new Error(`${name} not in report`);
const stored = await analyzeTank(client, report, Number(fight), actor.id, (m) => console.log('  ...', m));
const before = client.quota().requestsLastHour;
const t0 = Date.now();
const r = await runTankSims(stored, client, (req) => runSim(process.env.WOWSIMS_CLI!, req), Number(iterations), (m) => console.log('  ...', m));
console.log(`\n${client.quota().requestsLastHour - before} requests, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`Boss: from ${r.boss.from}${r.boss.dualWield ? ' (dual wield)' : ''}, gap ${r.boss.swingGapSec.toFixed(2)}s -> speed ${r.boss.swingSpeed.toFixed(2)}s, hit ${Math.round(r.boss.hitBeforeArmor)} -> min ${Math.round(r.boss.minBaseDamage)}`);
const v = stored.analysis.openerVerdict;
if (v) console.log(`Opener verdict: ${v.verdict} (${Math.round(v.tps)} vs ${Math.round(v.peerTps)} TPS, parts start ${Math.round(v.parts.start)} luck ${Math.round(v.parts.luck)} rotation ${Math.round(v.parts.rotation)})${v.reasons.map((x) => `\n  - ${x}`).join('')}`);
console.log('\nPLAYER            role share  TPS log/sim     %  rel   opener log/sim    %   DTPS log/sim');
for (const p of r.players) {
  console.log(
    `${(p.name + (p.you ? '*' : '')).padEnd(17)} ${p.role.padEnd(4)} ${String(Math.round(p.swingShare * 100)).padStart(4)}%  ${String(Math.round(p.actualTps)).padStart(5)}/${String(Math.round(p.simTps)).padEnd(5)} ${String(Math.round(p.threatPct)).padStart(4)} ${String(Math.round(p.relativePct)).padStart(4)}   ${String(Math.round(p.actualOpenerTps)).padStart(5)}/${String(Math.round(p.simOpenerTps)).padEnd(5)} ${String(Math.round(p.openerPct)).padStart(4)}   ${String(Math.round(p.actualDtps)).padStart(5)}/${Math.round(p.simDtps)}`,
  );
}
console.log('\nSCENARIOS');
for (const s of r.scenarios) console.log(`  ${s.label.padEnd(24)} TPS ${Math.round(s.tps)} (${s.deltaTps >= 0 ? '+' : ''}${Math.round(s.deltaTps)})  opener ${Math.round(s.openerTps ?? 0)}  DTPS ${Math.round(s.dtps)} (${s.deltaDtps >= 0 ? '+' : ''}${Math.round(s.deltaDtps)})${s.changes ? `  ${s.changes.length} slots` : ''}`);
for (const n of r.notes) console.log(`  note: ${n}`);
for (const w of r.warnings) console.log(`  warning: ${w}`);
