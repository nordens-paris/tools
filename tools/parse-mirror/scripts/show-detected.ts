// Dev helper: raid buffs/debuffs detected for each player of a saved analysis run.
import { analyze } from '../server/analysis/analyze.ts';
import { environmentOf } from '../server/sim/request.ts';
import { WclClient } from '../server/wcl/client.ts';
const [report, fight, source] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const s = await analyze(client, report, Number(fight), Number(source));
for (const raw of [s.you, ...s.top]) {
  const env = environmentOf(raw, s.spec);
  console.log(raw.fight.name, '|', env.detected.join(', '), '| bonus', JSON.stringify(env.bonusStats), '| debuffs', JSON.stringify(env.debuffs));
}
