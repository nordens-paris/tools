// How often a player's spell damage was partially resisted in a log, per ability: share of hits
// with a partial resist and share of the damage resisted. For comparing with the sim's resists.
// Usage: npx tsx --env-file=.env scripts/resist-check.ts <report> <fight> <source>
import { WclClient } from '../server/wcl/client.ts';

const [report, fightArg, sourceArg] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const fights = await client.fights(report);
const fight = fights.fights.find((f) => f.id === Number(fightArg))!;
type Ev = { type: string; hitType?: number; amount?: number; resisted?: number; tick?: boolean; ability: { name: string; type: number } };
const res = await client.events('damage-done', report, fight.start_time, fight.end_time, { sourceid: Number(sourceArg) });
const events = ((res as { events?: Ev[] }).events ?? (res as unknown as Ev[])).filter((e) => e.type === 'damage' && (e.amount ?? 0) > 0);
const by = new Map<string, { n: number; resistedHits: number; damage: number; resisted: number; school: number }>();
for (const e of events) {
  const key = `${e.ability.name}${e.tick ? ' (tick)' : ''}`;
  const r = by.get(key) ?? { n: 0, resistedHits: 0, damage: 0, resisted: 0, school: e.ability.type };
  r.n++;
  r.damage += e.amount!;
  if (e.resisted) {
    r.resistedHits++;
    r.resisted += e.resisted;
  }
  by.set(key, r);
}
console.log('ability                     school  hits  partially resisted  damage resisted');
for (const [k, r] of [...by].sort((a, b) => b[1].damage - a[1].damage))
  console.log(`${k.padEnd(28)} ${String(r.school).padStart(5)} ${String(r.n).padStart(5)}  ${((r.resistedHits / r.n) * 100).toFixed(1).padStart(8)}%  ${((r.resisted / (r.damage + r.resisted)) * 100).toFixed(1).padStart(14)}%`);
