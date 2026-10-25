// Dev helper: what one player did in a fight, for writing a new spec: their actor icon and pets,
// damage per ability, casts per ability (with spell IDs and icons), and buffs with uptime.
// Usage: npx tsx --env-file=.env scripts/log-probe.ts <report> <fight> <source>
import { WclClient } from '../server/wcl/client.ts';

const [report, fight, source] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const fights = await client.fights(report);
const f = fights.fights.find((x) => x.id === Number(fight))!;
const actor = fights.friendlies.find((a) => a.id === Number(source))!;
console.log(actor.name, actor.icon, f.name, `boss ${f.boss}`, `${((f.end_time - f.start_time) / 1000).toFixed(0)}s`);
console.log('pets:', (fights.friendlyPets ?? []).filter((p) => p.petOwner === actor.id && p.fights.some((x) => x.id === f.id)).map((p) => `${p.name} (${p.icon})`));
const range = { start: f.start_time, end: f.end_time, sourceid: actor.id };
const dmg = await client.table<{ entries: { name: string; guid: number; total: number; hitCount?: number; uses?: number }[] }>('damage-done', report, range);
const total = dmg.entries.reduce((s, e) => s + e.total, 0);
console.log('\nDAMAGE');
for (const e of dmg.entries.sort((a, b) => b.total - a.total)) console.log(`${e.guid}\t${e.name}\t${((e.total / total) * 100).toFixed(1)}%`);
const casts = await client.events('casts', report, f.start_time, f.end_time, { sourceid: actor.id });
const byName = new Map<string, { id: number; icon?: string; n: number; begin: number }>();
for (const e of casts) {
  if (!e.ability || e.sourceID !== actor.id) continue;
  const k = byName.get(e.ability.name) ?? { id: e.ability.guid, icon: e.ability.abilityIcon, n: 0, begin: 0 };
  if (e.type === 'cast') k.n++;
  if (e.type === 'begincast') k.begin++;
  byName.set(e.ability.name, k);
}
console.log('\nCASTS');
for (const [n, k] of [...byName].sort((a, b) => b[1].n - a[1].n)) console.log(`${k.id}\t${n}\t${k.n} casts\t${k.begin} begincasts\t${k.icon}`);
const buffs = await client.buffs(report, f.start_time, f.end_time, actor.id);
console.log('\nBUFFS');
for (const a of buffs.auras.sort((x, y) => y.totalUptime - x.totalUptime)) console.log(`${a.guid}\t${a.name}\t${((a.totalUptime / buffs.totalTime) * 100).toFixed(0)}%\t${a.totalUses}`);
const infos = await client.combatantInfos(report, f.start_time, f.end_time);
const me = infos.find((i) => i.sourceID === actor.id);
const { gear, auras, talents, ...stats } = me ?? ({} as any);
console.log('\nCOMBATANT', JSON.stringify(stats), 'talents', JSON.stringify(talents));
