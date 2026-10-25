// Extracts the small subset of the WoWSims database this tool needs (names/icons for
// items, enchants, gems, consumables) plus spec presets, from a checkout of
// https://github.com/wowsims/tbc-new (MIT licensed).
//
// Usage: node scripts/extract-wowsims-data.mjs <path-to-tbc-new-checkout>
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('Usage: node scripts/extract-wowsims-data.mjs <path-to-tbc-new-checkout>');
  process.exit(1);
}
const out = path.resolve('data/wowsims');
fs.mkdirSync(out, { recursive: true });

const db = JSON.parse(fs.readFileSync(path.join(src, 'assets/database/db.json'), 'utf8'));

const items = {};
for (const it of db.items) {
  items[it.id] = { n: it.name, i: it.icon, q: it.quality ?? 0 };
  // Gem sockets, for the raid's gear check; o: held in off-hand (can't be enchanted).
  if (it.gemSockets?.length) items[it.id].s = it.gemSockets.length;
  if (it.type === 13 && it.weaponType === 5) items[it.id].o = 1;
}
const enchants = {};
for (const e of db.enchants) {
  enchants[e.effectId] = { n: e.name, i: e.icon };
}
const gems = {};
for (const g of db.gems) {
  gems[g.id] = { n: g.name, i: g.icon, q: g.quality ?? 0 };
}
const consumables = db.consumables.map((c) => ({ id: c.id, type: c.type ?? 0, name: c.name }));
// TBC spell names by ID. Warcraft Logs' translation uses modern names (Death Wish -> "Bloodbath").
const spellNames = {};
for (const s of db.spellIcons) spellNames[s.id] = s.name;

// Stat procs on items (trinkets, rings, weapons), by the buff they give: what each proc is worth.
// On-use effects are the player's own cooldowns, so only chance-on-hit/cast procs are kept.
const procs = {};
for (const it of db.items) {
  for (const e of it.itemEffects ?? []) {
    const stats = e.scalingOptions?.['0']?.stats;
    if (!e.proc || !e.buffId || !stats || !Object.keys(stats).length) continue;
    procs[e.buffId] = { item: it.name, stats };
  }
}

const write = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data));
write('procs.json', procs);
write('items.json', items);
write('enchants.json', enchants);
write('gems.json', gems);
write('consumables.json', consumables);
write('spell-names.json', spellNames);

const copy = (from, to) => fs.copyFileSync(path.join(src, from), path.join(out, to));
copy('ui/specs/warrior/dps/apls/fury.apl.json', 'warrior-fury.apl.json');
copy('ui/specs/warrior/dps/apls/arms.apl.json', 'warrior-arms.apl.json');
copy('ui/specs/warlock/dps/apls/destruction.apl.json', 'warlock-destruction.apl.json');
copy('ui/specs/warlock/dps/apls/destro_fire.apl.json', 'warlock-destro-fire.apl.json');
copy('ui/specs/warlock/dps/apls/affliction.apl.json', 'warlock-affliction.apl.json');
copy('ui/specs/mage/dps/apls/arcane.apl.json', 'mage-arcane.apl.json');
copy('ui/specs/priest/dps/apls/default.apl.json', 'priest-shadow.apl.json');
copy('ui/specs/warlock/dps/apls/demonology.apl.json', 'warlock-demonology.apl.json');

// Talent trees (talent order and rank spell IDs), to turn armory talents into talent strings.
fs.mkdirSync(path.join(out, 'talents'), { recursive: true });
for (const cls of ['warrior', 'warlock', 'mage', 'priest', 'rogue', 'hunter', 'shaman', 'druid', 'paladin']) {
  const file = path.join(src, `ui/sim/talents/trees/${cls}.json`);
  if (!fs.existsSync(file)) continue;
  const trees = JSON.parse(fs.readFileSync(file, 'utf8')).map((tree) => ({
    name: tree.name,
    talents: tree.talents
      .sort((a, b) => a.location.rowIdx - b.location.rowIdx || a.location.colIdx - b.location.colIdx)
      .map((t) => ({ name: t.fancyName, spellIds: t.spellIds, maxPoints: t.maxPoints })),
  }));
  fs.writeFileSync(path.join(out, 'talents', `${cls}.json`), JSON.stringify(trees));
}

console.log(
  `Wrote ${Object.keys(items).length} items, ${Object.keys(enchants).length} enchants, ` +
    `${Object.keys(gems).length} gems, ${consumables.length} consumables to ${out}`,
);
