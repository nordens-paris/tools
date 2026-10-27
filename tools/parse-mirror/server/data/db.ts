// Name/icon lookups from the WoWSims database (see scripts/extract-wowsims-data.mjs).
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('data/wowsims');
const loaded = new Map<string, unknown>();
/** Reads a data file once; later calls share the parsed object, so don't mutate it. */
const load = <T>(file: string): T => {
  if (!loaded.has(file)) loaded.set(file, JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
  return loaded.get(file) as T;
};

// s: gem sockets; o: held in off-hand (can't be enchanted).
const items = load<Record<string, { n: string; i: string; q: number; s?: number; o?: 1 }>>('items.json');
const enchants = load<Record<string, { n: string; i: string }>>('enchants.json');
const gems = load<Record<string, { n: string; i: string; q: number }>>('gems.json');

export interface Consumable {
  id: number;
  type: number;
  name: string;
}
export const consumables = load<Consumable[]>('consumables.json');

// Matches proto ConsumableType in WoWSims.
export const ConsumableType = {
  Potion: 1,
  Flask: 2,
  Food: 3,
  BattleElixir: 6,
  GuardianElixir: 7,
} as const;

const spellNames = load<Record<string, string>>('spell-names.json');

/** The TBC name of a spell, falling back to the name Warcraft Logs gave. */
export const spellName = (id: number, fallback: string) => spellNames[id] ?? fallback;

/**
 * Items whose ID in the logs differs from WoWSims' for the same item. The Battlemaster's trinkets
 * show up in Anniversary logs as 34576-34580; WoWSims has them as 34163, 34162, 33832, 34049 and
 * 34050 (same names, icons and effects).
 */
const ITEM_ALIASES: Record<number, number> = {
  34576: 34163, // Battlemaster's Cruelty
  34577: 34162, // Battlemaster's Depravity
  34578: 33832, // Battlemaster's Determination
  34579: 34049, // Battlemaster's Audacity
  34580: 34050, // Battlemaster's Perseverance
};
/** The WoWSims item ID for an item ID from a log. */
export const simItemId = (id: number) => ITEM_ALIASES[id] ?? id;
export const itemInfo = (id: number) => items[simItemId(id)];
export const enchantInfo = (effectId: number) => enchants[effectId];
export const gemInfo = (id: number) => gems[id];

export const loadJson = load;

// Tank-relevant stats on items, gems and enchants (str, agi, sta, def, dodge, parry, block...).
type Stats = Record<string, number>;
const tankStats = load<{ items: Record<string, Stats>; gems: Record<string, Stats>; enchants: Record<string, Stats> }>('tank-stats.json');

/** Sum of the tank-relevant stats on a player's gear, gems and enchants (no set bonuses or procs). */
export function gearStats(gear: { id: number; permanentEnchant?: number; gems?: { id: number }[] }[]): Stats {
  const total: Stats = {};
  const add = (st?: Stats) => {
    for (const [k, v] of Object.entries(st ?? {})) total[k] = (total[k] ?? 0) + v;
  };
  for (const g of gear) {
    if (!g.id) continue;
    add(tankStats.items[simItemId(g.id)]);
    if (g.permanentEnchant) add(tankStats.enchants[g.permanentEnchant]);
    for (const gem of g.gems ?? []) add(tankStats.gems[gem.id]);
  }
  return total;
}
