// Debug: raw WCL hit details and per-event hit types for one player's ability.
// Usage: npx tsx --env-file=.env scripts/raw-hits.ts <report> <fight> <source> <ability name>
import { WclClient } from '../server/wcl/client.ts';

const [report, fightId, source, ability] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const f = (await client.fights(report)).fights.find((x) => x.id === Number(fightId))!;
const table = await client.table<{ entries: any[] }>('damage-done', report, { start: f.start_time, end: f.end_time, sourceid: Number(source) });
const entry = table.entries.find((e) => e.name === ability);
const { targets, ...rest } = entry ?? {};
console.log(JSON.stringify(rest, null, 1));
const events = await client.events('damage-done', report, f.start_time, f.end_time, { sourceid: Number(source) });
const mine = events.filter((e: any) => e.ability?.name === ability);
const byType = new Map<string, number>();
for (const e of mine) {
  const k = `hitType=${e.hitType}${e.tick ? ' tick' : ''}${e.resisted ? ' resisted' : ''}`;
  byType.set(k, (byType.get(k) ?? 0) + 1);
}
console.log(mine.length, 'events', [...byType]);
// Auras the log lists on each event, with how often they appear.
const auras = new Map<string, number>();
for (const e of mine) for (const id of String(e.buffs ?? '').split('.').filter(Boolean)) auras.set(id, (auras.get(id) ?? 0) + 1);
console.log('auras on events', [...auras].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id}:${n}`).join(' '));
