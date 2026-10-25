// Dev helper: damage taken and rage gains per player, from the last fury analysis.
import fs from 'node:fs';
import { WclClient } from '../server/wcl/client.ts';
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const a = JSON.parse(fs.readFileSync(process.argv[2] ?? '.cache/fury-analysis.json', 'utf8'));
const get = (client as unknown as { get: (e: string, p: Record<string, string | number>) => Promise<any> }).get.bind(client);
for (const p of [a.you, ...a.top]) {
  const fights = await client.fights(p.report);
  const f = fights.fights.find((x) => x.id === p.fight)!;
  const range = { start: f.start_time, end: f.end_time };
  const taken = await get(`report/tables/damage-taken/${p.report}`, { ...range, sourceid: p.source });
  const takenTotal = (taken.entries ?? []).reduce((s: number, e: any) => s + e.total, 0);
  const top = (taken.entries ?? []).sort((x: any, y: any) => y.total - x.total).slice(0, 3).map((e: any) => `${e.name} ${Math.round(e.total / 1000)}k`);
  const gains = await get(`report/tables/resources-gains/${p.report}`, { ...range, sourceid: p.source, abilityid: 101 }).catch((e: Error) => ({ err: e.message }));
  const gainList = (gains.resources ?? []).map((e: any) => `${e.name} ${e.gains}${e.wasted ? "(-" + e.wasted + ")" : ""}`);
  console.log(`${p.name.padEnd(10)} ${p.durationSec.toFixed(0)}s taken ${(takenTotal / p.durationSec).toFixed(0)}/s [${top.join(', ')}] gains: ${gainList.join(', ') || JSON.stringify(gains).slice(0, 200)}`);
}
