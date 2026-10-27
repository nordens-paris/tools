// Dev helper: the full tank analysis (peers, compared rows, findings) for one tank.
// Usage: npx tsx --env-file=.env scripts/tank-analyze.ts <report>:<fight> <tank name>
import { analyzeTank } from '../server/analysis/tank/compare.ts';
import { WclClient } from '../server/wcl/client.ts';
import type { HealerRow } from '../shared/types.ts';

const [target, name] = process.argv.slice(2);
const [report, fight] = target.split(':');
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const actor = (await client.fights(report)).friendlies.find((a) => a.name === name);
if (!actor) throw new Error(`${name} not in report`);
const before = client.quota().requestsLastHour;
const t0 = Date.now();
const { analysis: a } = await analyzeTank(client, report, Number(fight), actor.id, (m) => console.log('  ...', m));
console.log(`\n${a.you.name} (${a.you.specLabel}, ${a.you.role}) on ${a.encounter.name}: ${client.quota().requestsLastHour - before} requests, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`Peers (${a.group.match}): ${a.peers.map((p) => `${p.name} (${p.peer.raidRanking.metric} #${p.peer.raidRanking.rank}, ${Math.round(p.peer.swingShare * 100)}%)`).join(', ')}\n  ${a.group.description}`);
console.log(`Other tanks in your raid: ${a.raidTanks.map((t) => `${t.name} ${t.role} ${Math.round(t.swingShare * 100)}%`).join(', ') || '-'}`);
const f = (r: HealerRow, v: number | null) =>
  v === null ? '-' : r.format === 'pct' ? `${Math.round(v * 100)}%` : r.format === 'sec' ? `${v.toFixed(1)}s` : r.format === 'dec' ? v.toFixed(1) : Math.round(v).toString();
for (const [title, rows] of [['JUDGED', a.judged], ['CONTEXT', a.context]] as const) {
  console.log(`\n${title}${''.padEnd(46 - title.length)}${'you'.padStart(8)}${'peers'.padStart(8)}   each`);
  for (const r of rows) console.log(`  ${r.label.padEnd(46)}${f(r, r.you).padStart(8)}${f(r, r.median).padStart(8)}   ${r.peers.map((v) => f(r, v)).join(' ')}`);
}
console.log('\nFINDINGS');
for (const x of a.findings) console.log(`  [${x.severity}] (${x.tab}) ${x.title}\n      ${x.detail}`);
for (const w of a.warnings) console.log(`  warning: ${w}`);
