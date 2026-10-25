// Dev helper: a player's damage split by target, to spot damage on adds.
import { WclClient } from '../server/wcl/client.ts';
const [report, fightId, source] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const get = (client as unknown as { get: (e: string, p: Record<string, string | number>) => Promise<any> }).get.bind(client);
const fights = await client.fights(report);
const f = fights.fights.find((x) => x.id === Number(fightId))!;
const t = await get(`report/tables/damage-done/${report}`, { start: f.start_time, end: f.end_time, sourceid: Number(source), by: 'target' });
console.log(JSON.stringify((t.entries ?? []).map((e: any) => ({ name: e.name, id: e.id, total: e.total, type: e.type }))).slice(0, 600));
