// Dev helper: a player's pets in a fight and what they did.
import { WclClient } from '../server/wcl/client.ts';
const [report, fightId, source] = process.argv.slice(2);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const fights = await client.fights(report);
const f = fights.fights.find((x) => x.id === Number(fightId))!;
for (const pet of (fights.friendlyPets ?? []).filter((p) => p.petOwner === Number(source))) {
  const inFight = pet.fights.some((x) => x.id === f.id);
  const dmg = inFight ? await client.table('damage-done', report, { start: f.start_time, end: f.end_time, sourceid: pet.id }) : undefined;
  const casts = inFight ? await client.events('casts', report, f.start_time, f.end_time, { sourceid: pet.id }) : [];
  console.log(pet.name, pet.icon, 'inFight', inFight, 'damage', dmg?.entries.reduce((s, e) => s + e.total, 0), 'casts', casts.length);
}
