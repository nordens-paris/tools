// Dev helper: who shares party auras with a player, and which shamans are in the fight.
import { WclClient } from '../server/wcl/client.ts';
const [report, fightId, source] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const fights = await client.fights(report);
const f = fights.fights.find((x) => x.id === Number(fightId))!;
const infos = await client.combatantInfos(report, f.start_time, f.end_time);
const name = (id: number) => fights.friendlies.find((a) => a.id === id)?.name + '(' + fights.friendlies.find((a) => a.id === id)?.icon + ')';
const me = infos.find((i: any) => i.sourceID === Number(source))!;
console.log('my auras', me.auras.map((a: any) => `${a.name}#${a.ability} from ${name(a.source)}`).join('; '));
for (const i of infos as any[]) {
  const party = i.auras.filter((a: any) => /Aura|Totem|Shout|Presence|Inspiration|Trueshot|Leader/.test(a.name ?? '')).map((a: any) => `${a.name} from ${name(a.source)}`);
  console.log(name(i.sourceID).padEnd(28), party.join('; '));
}
