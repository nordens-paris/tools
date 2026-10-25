// Dev helper: for each compared player, the shamans in their raid and the party auras they had,
// to see why totems were or weren't found.
// Usage: npx tsx --env-file=.env scripts/party-check.ts <report> <fight> <source>
import { analyze } from '../server/analysis/analyze.ts';
import { WclClient } from '../server/wcl/client.ts';

const [report, fight, source] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const s = await analyze(client, report, Number(fight), Number(source));
for (const raw of [s.you, ...s.top]) {
  const f = raw.fight;
  const fights = await client.fights(f.report);
  const shamans = fights.friendlies.filter((a) => a.icon.startsWith('Shaman') && a.fights.some((x) => x.id === f.fight)).map((a) => a.icon.replace('Shaman-', ''));
  const totems = f.buffs.filter((b) => b.fromPartyShaman).map((b) => `${b.name}${b.assumed ? '*' : ''}`);
  const moonkin = f.buffs.some((b) => b.name === 'Moonkin Aura');
  console.log(`${f.rank ?? 'you'} ${f.name}: moonkin ${moonkin} shamans [${shamans.join(',')}] totems [${totems.join(', ')}] spDps ${Math.round(f.partyShadowPriestDps ?? 0)}`);
}
