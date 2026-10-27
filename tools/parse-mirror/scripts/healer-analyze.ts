// Dev helper: the full healer analysis (peers, compared rows, spells, findings) for one healer.
// Usage: npx tsx --env-file=.env scripts/healer-analyze.ts <report>:<fight> <healer name>
import { analyzeHealer } from '../server/analysis/healer/compare.ts';
import { WclClient } from '../server/wcl/client.ts';
import type { HealerRow } from '../shared/types.ts';

const [target, name] = process.argv.slice(2);
const [report, fight] = target.split(':');
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const fights = await client.fights(report);
const actor = fights.friendlies.find((a) => a.name === name);
if (!actor) throw new Error(`${name} not in report`);
const before = client.quota().requestsLastHour;
const t0 = Date.now();
const a = await analyzeHealer(client, report, Number(fight), actor.id, (m) => console.log('  ...', m));
console.log(`\n${a.you.name} (${a.you.specLabel}, ${a.you.role}) on ${a.encounter.name}: ${client.quota().requestsLastHour - before} requests, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`Peers (${a.group.match}): ${a.peers.map((p) => p.name).join(', ')}\n  ${a.group.description}`);

const f = (r: HealerRow, v: number | null) =>
  v === null ? '-' : r.format === 'pct' ? `${Math.round(v * 100)}%` : r.format === 'sec' ? `${v.toFixed(1)}s` : r.format === 'dec' ? v.toFixed(1) : Math.round(v).toString();
for (const [title, rows] of [['JUDGED', a.judged], ['CONTEXT', a.context]] as const) {
  console.log(`\n${title}${''.padEnd(36 - title.length)}${'you'.padStart(8)}${'peers'.padStart(8)}   each`);
  for (const r of rows) console.log(`  ${r.label.padEnd(36)}${f(r, r.you).padStart(8)}${f(r, r.median).padStart(8)}   ${r.peers.map((v) => f(r, v)).join(' ')}`);
}
console.log('\nSPELLS (share / heal per mana / overheal: you vs peers)');
for (const s of a.spells.slice(0, 8)) {
  const h = (v: number | null) => (v === null ? '-' : v.toFixed(1));
  console.log(`  ${s.name.padEnd(24)} ${Math.round(s.you.share * 100)}% / ${Math.round(s.peers.share * 100)}%   ${h(s.you.healPerMana)} / ${h(s.peers.healPerMana)}   ${Math.round(s.you.overheal * 100)}% / ${Math.round(s.peers.overheal * 100)}%  (${s.peers.users} peers use it)`);
}
console.log('\nFINDINGS');
for (const x of a.findings) console.log(`  [${x.severity}] (${x.tab}) ${x.title}\n      ${x.detail}`);
for (const w of a.warnings) console.log(`  warning: ${w}`);
