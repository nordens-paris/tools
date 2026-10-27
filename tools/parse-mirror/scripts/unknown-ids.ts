// Dev helper: gear item, gem and enchant IDs seen in cached logs (every player of every analysis run
// on this machine) that WoWSims or our data files don't know, most-worn first. Unknown items are left
// out of sims; an ID that is the same item under another ID can go in ITEM_ALIASES (server/data/db.ts).
// Usage: npx tsx scripts/unknown-ids.ts
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { enchantInfo, gemInfo, itemInfo } from '../server/data/db.ts';
import { tempEnchantName } from '../server/data/consumes.ts';

const dir = '.cache/wcl';
type Seen = { count: number; players: Set<string>; slots: Set<number>; icon?: string; example?: string };
const items = new Map<number, Seen>(), gems = new Map<number, Seen>(), enchants = new Map<number, Seen>(), temps = new Map<number, Seen>();
let infos = 0;
const add = (m: Map<number, Seen>, id: number, who: string, slot: number, icon?: string) => {
  const s = m.get(id) ?? { count: 0, players: new Set(), slots: new Set(), icon };
  s.count++; s.players.add(who); s.slots.add(slot); s.icon ??= icon; m.set(id, s);
};
for (const f of fs.readdirSync(dir)) {
  let buf = fs.readFileSync(path.join(dir, f));
  if (f.endsWith('.gz')) buf = zlib.gunzipSync(buf);
  const text = buf.toString('utf8');
  if (!text.includes('combatantinfo')) continue;
  const data = JSON.parse(text);
  const events = (data.data ?? data).events ?? [];
  for (const e of events) {
    if (e.type !== 'combatantinfo' || !Array.isArray(e.gear)) continue;
    infos++;
    const who = `${e.sourceID}@${f.slice(0, 6)}`;
    e.gear.forEach((g: { id: number; icon?: string; permanentEnchant?: number; temporaryEnchant?: number; gems?: { id: number; icon?: string }[] }, slot: number) => {
      if (!g?.id || slot === 3 || slot === 18) return;
      if (!itemInfo(g.id)) add(items, g.id, who, slot, g.icon);
      for (const gem of g.gems ?? []) if (gem.id && !gemInfo(gem.id)) add(gems, gem.id, who, slot, gem.icon);
      if (g.permanentEnchant && !enchantInfo(g.permanentEnchant)) add(enchants, g.permanentEnchant, who, slot);
      if (g.temporaryEnchant && !tempEnchantName(g.temporaryEnchant)) add(temps, g.temporaryEnchant, who, slot);
    });
  }
}
const SLOT: Record<number, string> = { 0: 'Head', 1: 'Neck', 2: 'Shoulder', 4: 'Chest', 5: 'Waist', 6: 'Legs', 7: 'Feet', 8: 'Wrist', 9: 'Hands', 10: 'Finger', 11: 'Finger', 12: 'Trinket', 13: 'Trinket', 14: 'Back', 15: 'Main Hand', 16: 'Off Hand', 17: 'Ranged' };
const wowhead = (id: number) => `https://www.wowhead.com/tbc/item=${id}`;
const show = (title: string, m: Map<number, Seen>, link?: (id: number) => string) => {
  console.log(`\n${title} (${m.size})`);
  for (const [id, s] of [...m].sort((a, b) => b[1].players.size - a[1].players.size)) {
    const slots = [...s.slots].map((x) => SLOT[x] ?? x).filter((v, i, a) => a.indexOf(v) === i);
    console.log(`  ${id}\t${s.players.size} players\t${slots.join('/')}\t${(s.icon ?? '').replace('.jpg', '')}${link ? `\t${link(id)}` : ''}`);
  }
};
console.log(`${infos} combatant infos scanned`);
show('ITEMS not in WoWSims', items, wowhead);
show('GEMS not known', gems, wowhead);
show('PERMANENT ENCHANTS not known', enchants);
show('TEMPORARY ENCHANTS not known', temps);
