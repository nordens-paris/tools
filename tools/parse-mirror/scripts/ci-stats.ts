// Dev helper: a player's combatant info stats (ratings at the pull).
import { WclClient } from '../server/wcl/client.ts';
const [report, fightId, source] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const fights = await client.fights(report);
const f = fights.fights.find((x) => x.id === Number(fightId))!;
const ci: any = (await client.combatantInfos(report, f.start_time, f.end_time)).find((c: any) => c.sourceID === Number(source));
const { gear, auras, talents, talentTree, ...rest } = ci;
console.log(JSON.stringify(rest));
