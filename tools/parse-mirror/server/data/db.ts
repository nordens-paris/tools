// Name/icon lookups from the WoWSims database (see scripts/extract-wowsims-data.mjs).
import fs from 'node:fs';
import path from 'node:path';

import { simItemId } from './gear.ts';

const dir = path.resolve('data/wowsims');
const loaded = new Map<string, unknown>();
/** Reads a data file once; later calls share the parsed object, so don't mutate it. */
const load = <T>(file: string): T => {
  if (!loaded.has(file)) loaded.set(file, JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
  return loaded.get(file) as T;
};

// s: gem sockets; o: held in off-hand (can't be enchanted); w: weapon type (proto WeaponType).
const items = load<Record<string, { n: string; i: string; q: number; s?: number; o?: 1; w?: number }>>('items.json');
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

export { gearStats, simItemId } from './gear.ts';
export const itemInfo = (id: number) => items[simItemId(id)];
export const enchantInfo = (effectId: number) => enchants[effectId];
export const gemInfo = (id: number) => gems[id];

export const loadJson = load;
