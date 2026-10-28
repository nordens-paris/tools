// Dev helper for a new spec: what the top ranked players of a class/spec do on a boss. Per player:
// weapons (with WoWSims weapon type), temporary enchants, hit/expertise rating, pets, talent split,
// and casts per minute; then the casts most of them use. Doesn't need a spec module.
//
//   npx tsx --env-file=.env scripts/top-probe.ts <encounterId> <wclClassId> <wclSpecId> [count]
import { itemInfo, spellName } from '../server/data/db.ts';
import { WclClient } from '../server/wcl/client.ts';

const [encounter, classId, specId, count = 8] = process.argv.slice(2).map(Number);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const WEAPON = ['', 'axe', 'dagger', 'fist', 'mace', 'off-hand', 'polearm', 'shield', 'staff', 'sword'];
const castsByPlayer: Map<string, number>[] = [];
let shown = 0;
for (const r of (await client.rankings(encounter, classId, specId)).rankings) {
  if (shown >= count) break;
  try {
    const fights = await client.fights(r.reportID);
    const f = fights.fights.find((x) => x.id === r.fightID)!;
    const actor = fights.friendlies.find((a) => a.name === r.name && a.fights.some((x) => x.id === f.id))!;
    const info = (await client.combatantInfos(r.reportID, f.start_time, f.end_time)).find((i) => i.sourceID === actor.id);
    const casts = await client.events('casts', r.reportID, f.start_time, f.end_time, { sourceid: actor.id });
    const minutes = (f.end_time - f.start_time) / 60000;
    const counts = new Map<string, number>();
    for (const e of casts) if (e.type === 'cast' && e.sourceID === actor.id && e.ability) counts.set(spellName(e.ability.guid, e.ability.name), (counts.get(spellName(e.ability.guid, e.ability.name)) ?? 0) + 1);
    castsByPlayer.push(counts);
    const weapon = (slot: number) => {
      const g = info?.gear[slot];
      if (!g?.id) return '-';
      const it = itemInfo(g.id);
      return `${it?.n ?? g.id}${it?.w ? ` (${WEAPON[it.w]})` : ''}${g.temporaryEnchant ? ` [te ${g.temporaryEnchant}]` : ''}`;
    };
    const pets = (fights.friendlyPets ?? []).filter((p) => p.petOwner === actor.id && p.fights.some((x) => x.id === f.id)).map((p) => p.name);
    const split = (info?.talents ?? []).map((t) => t.id).join('/');
    shown++;
    console.log(`\n#${shown} ${r.name} ${actor.icon} ${Math.round(r.total)} DPS, ${minutes.toFixed(1)} min, talents ${split}, hit ${info?.hitMelee ?? '-'}/${info?.hitSpell ?? '-'}, exp ${info?.expertise ?? '-'}`);
    console.log(`  MH ${weapon(15)} | OH ${weapon(16)} | R ${weapon(17)}${pets.length ? ` | pets ${pets.join(', ')}` : ''}`);
    console.log(`  ${[...counts].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([n, c]) => `${n} ${(c / minutes).toFixed(1)}`).join(', ')}`);
  } catch (e) {
    console.log(`(skipped ${r.name}: ${(e as Error).message.slice(0, 80)})`);
  }
}
const names = new Set(castsByPlayer.flatMap((m) => [...m.keys()]));
const common = [...names].map((n) => [n, castsByPlayer.filter((m) => m.has(n)).length] as const).sort((a, b) => b[1] - a[1]);
console.log(`\nCasts by how many of the ${castsByPlayer.length} players used them: ${common.map(([n, c]) => `${n} ${c}`).join(', ')}`);
