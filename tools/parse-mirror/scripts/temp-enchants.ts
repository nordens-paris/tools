// Dev helper: main-hand temporary enchants at each boss pull, per player.
import { WclClient } from '../server/wcl/client.ts';
const [report] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const fights = await client.fights(report);
const counts = new Map<string, number>();
for (const f of fights.fights.filter((x) => x.boss && x.kill)) {
  for (const i of await client.combatantInfos(report, f.start_time, f.end_time)) {
    const actor = fights.friendlies.find((a) => a.id === i.sourceID);
    const key = `${actor?.icon} MH ${i.gear[15]?.temporaryEnchant ?? '-'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
}
console.log([...counts].sort().map(([k, v]) => `${k}: ${v}`).join('\n'));
