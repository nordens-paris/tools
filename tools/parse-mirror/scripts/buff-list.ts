// Dev helper: every buff on a player during a fight, straight from the buffs table.
import { WclClient } from '../server/wcl/client.ts';
const [report, fightId, source] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const fights = await client.fights(report);
const f = fights.fights.find((x) => x.id === Number(fightId))!;
const t = await client.buffs(report, f.start_time, f.end_time, Number(source));
console.log(t.auras.map((a: any) => `${a.name}#${a.guid} ${((a.totalUptime / (f.end_time - f.start_time)) * 100).toFixed(0)}%`).join(', '));
