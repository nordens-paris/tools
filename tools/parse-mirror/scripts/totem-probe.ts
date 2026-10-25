// Dev helper: a shaman's casts around a fight, to check totem detection.
import { WclClient } from '../server/wcl/client.ts';
const [report, fightId, name] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const fights = await client.fights(report);
const f = fights.fights.find((x) => x.id === Number(fightId))!;
const sh = fights.friendlies.find((a) => a.name === name)!;
const ev = await client.events('casts', report, f.start_time - 600_000, f.end_time, { sourceid: sh.id });
const counts = new Map<string, number>(); for (const e of ev) if (e.type === "cast" && e.timestamp >= f.start_time) counts.set(e.ability!.name, (counts.get(e.ability!.name) ?? 0) + 1);
console.log("in fight:", JSON.stringify([...counts]));
for (const e of ev) if (e.type === "cast" && /Totem/.test(e.ability?.name ?? "")) console.log(((e.timestamp - f.start_time) / 1000).toFixed(0).padStart(6), e.ability!.name, e.ability!.guid);
