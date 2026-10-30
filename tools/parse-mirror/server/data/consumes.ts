// Detects consumables from a player's buffs, casts and weapon enchants, and maps
// them to the IDs WoWSims expects.
import type { ConsumeUse } from '../../shared/types.ts';
import { ConsumableType, consumables } from './db.ts';

// Buff spell ID -> WoWSims food item ID. "Well Fed" buffs all share a name,
// so the spell ID is the only way to tell foods apart.
const WELL_FED: Record<number, { name: string; simId: number }> = {
  33256: { name: 'Roasted Clefthoof (20 Str)', simId: 27658 },
  33261: { name: 'Warp Burger / Grilled Mudfish (20 Agi)', simId: 27659 },
  33259: { name: 'Ravager Dog (40 AP)', simId: 27655 },
  33263: { name: 'Blackened Basilisk (23 Spell Dmg)', simId: 27657 },
};

// Potion buff/cast spell ID -> WoWSims item ID.
const POTIONS: Record<number, { name: string; simId: number }> = {
  28507: { name: 'Haste Potion', simId: 22838 },
  28494: { name: 'Insane Strength Potion', simId: 22828 },
  28506: { name: 'Heroic Potion', simId: 22837 },
  28508: { name: 'Destruction Potion', simId: 22839 },
  17528: { name: 'Mighty Rage Potion', simId: 13442 },
  28515: { name: 'Ironshield Potion', simId: 22849 },
  28499: { name: 'Super Mana Potion', simId: 22832 },
};

type Flag = 'superSapper' | 'goblinSapper' | 'scrollAgi' | 'scrollStr' | 'petScrollAgi' | 'petScrollStr' | 'nightmareSeed' | 'boglingRoot';

// Engineering items, keyed by cast spell ID. A number is a WoWSims explosive ID.
const ENGINEERING: Record<number, { name: string; sim?: Flag | number }> = {
  30486: { name: 'Super Sapper Charge', sim: 'superSapper' },
  13241: { name: 'Goblin Sapper Charge', sim: 'goblinSapper' },
  30217: { name: 'Adamantite Grenade', sim: 30217 },
  30216: { name: 'Fel Iron Bomb', sim: 30216 },
};

// Other used items, keyed by cast name (with translate=true names are English).
const OTHER_CASTS: Record<string, { name: string; conjuredId?: number; flag?: Flag; simulated?: boolean }> = {
  'Flame Cap': { name: 'Flame Cap', conjuredId: 22788 },
  'Nightmare Seed': { name: 'Nightmare Seed', flag: 'nightmareSeed' },
  'Fury of the Bogling': { name: 'Bogling Root', flag: 'boglingRoot' },
  // Same mana and shared cooldown; WoWSims only has the Demonic Rune.
  'Dark Rune': { name: 'Dark Rune', conjuredId: 12662 },
  'Demonic Rune': { name: 'Demonic Rune', conjuredId: 12662 },
  // Not here: "Dark Iron Pipeweed", "Hopped Up" and "Dire Drunkard" are the on-use buffs of the
  // trinkets Dark Iron Smoking Pipe, Direbrew Hops and Empty Mug of Direbrew, which WoWSims sims
  // from the player's gear.
};

const SCROLLS: Record<number, { name: string; sim: Flag }> = {
  33077: { name: 'Scroll of Agility V', sim: 'scrollAgi' },
  33082: { name: 'Scroll of Strength V', sim: 'scrollStr' },
};

/** The same scrolls on a pet: read from scroll events on it, see petScrollsOn in collect.ts. */
const PET_SCROLLS: Record<number, { name: string; sim: Flag; icon: string }> = {
  33077: { name: 'Pet: Scroll of Agility V', sim: 'petScrollAgi', icon: 'spell_holy_blessingofagility.jpg' },
  33082: { name: 'Pet: Scroll of Strength V', sim: 'petScrollStr', icon: 'spell_nature_strength.jpg' },
};
export const PET_SCROLL_IDS = Object.keys(PET_SCROLLS).map(Number);

const DRUMS: Record<number, { name: string; sim: string }> = {
  35476: { name: 'Drums of Battle', sim: 'LesserDrumsOfBattle' },
  35475: { name: 'Drums of War', sim: 'LesserDrumsOfWar' },
  351355: { name: 'Greater Drums of Battle', sim: 'GreaterDrumsOfBattle' },
};

// Weapon temporary enchant effect ID -> imbue. WoWSims identifies imbues by spell ID.
const IMBUES: Record<number, { name: string; simId?: number; icon: string }> = {
  2713: { name: 'Adamantite Sharpening Stone', simId: 29453, icon: 'inv_stone_sharpeningstone_07' },
  2955: { name: 'Adamantite Weightstone', simId: 34340, icon: 'inv_stone_weightstone_07' },
  2684: { name: 'Consecrated Sharpening Stone', simId: 28891, icon: 'inv_stone_sharpeningstone_02' },
  2628: { name: 'Brilliant Wizard Oil', simId: 25122, icon: 'inv_potion_105' },
  2677: { name: 'Superior Wizard Oil', simId: 28017, icon: 'inv_potion_141' },
  // Rogue poisons: WoWSims takes the poison's spell ID as the imbue (sim/rogue/poisons.go).
  2641: { name: 'Instant Poison VII', simId: 26891, icon: 'ability_poisons' },
  2643: { name: 'Deadly Poison VII', simId: 27186, icon: 'ability_rogue_dualweild' },
  2644: { name: 'Wound Poison V', simId: 27188, icon: 'inv_misc_herb_16' },
  // Not in WoWSims (healers' oils, older stones): only shown, not simmed.
  2629: { name: 'Brilliant Mana Oil', icon: 'inv_potion_100' },
  2678: { name: 'Superior Mana Oil', icon: 'inv_potion_101' },
  2685: { name: 'Blessed Wizard Oil', icon: 'inv_potion_26' },
  2712: { name: 'Fel Sharpening Stone', icon: 'inv_stone_sharpeningstone_06' },
  2954: { name: 'Fel Weightstone', icon: 'inv_stone_weightstone_06' },
  2506: { name: 'Elemental Sharpening Stone', icon: 'inv_stone_02' },
};

// Temporary enchants applied by a shaman's Windfury Totem rather than a consumable.
const WINDFURY_TOTEM_ENCHANTS = new Set([2639]);

/** WoWSims' ShamanImbue names. */
export type ShamanImbue = 'WindfuryWeapon' | 'FlametongueWeapon' | 'FrostbrandWeapon' | 'RockbiterWeapon';
// A shaman's own weapon imbues, every rank (enchant IDs from WoWSims' spell data). They're class
// spells, not consumables: the shaman specs pass them to the sim as spec options.
const SHAMAN_IMBUES: Record<number, { name: string; imbue: ShamanImbue }> = Object.fromEntries([
  ...[283, 284, 525, 1669, 2636].map((id) => [id, { name: 'Windfury Weapon', imbue: 'WindfuryWeapon' }]),
  ...[5, 4, 3, 523, 1665, 1666, 2634].map((id) => [id, { name: 'Flametongue Weapon', imbue: 'FlametongueWeapon' }]),
  ...[2, 12, 524, 1667, 1668, 2635].map((id) => [id, { name: 'Frostbrand Weapon', imbue: 'FrostbrandWeapon' }]),
  ...[3021].map((id) => [id, { name: 'Rockbiter Weapon', imbue: 'RockbiterWeapon' }]),
]);

/** The shaman imbue a weapon's temporary enchant is, if any. */
export const shamanImbueOf = (effect?: number) => (effect ? SHAMAN_IMBUES[effect]?.imbue : undefined);

// Elixirs WoWSims doesn't have (healers', tanks' and old ones), by buff name: only used to see that
// an elixir slot was filled.
const OTHER_ELIXIRS: Record<string, 'Battle Elixir' | 'Guardian Elixir'> = {
  'Greater Intellect': 'Guardian Elixir',
  'Mana Regeneration': 'Guardian Elixir',
  'Greater Armor': 'Guardian Elixir',
  'Health II': 'Guardian Elixir',
  'Earthen Elixir': 'Guardian Elixir',
  "Major Troll's Blood Potion": 'Guardian Elixir',
  'Greater Agility': 'Battle Elixir',
  'Greater Firepower': 'Battle Elixir',
  'Elixir of the Sages': 'Battle Elixir',
};

// Elixirs whose buff is named unlike the item: buff ID -> item ID. Major Mageblood's buff is
// "Greater Versatility" in the log.
const ELIXIR_BUFFS: Record<number, number> = { 28509: 22840 };

// Elixir buff names don't always match item names ("Major Agility" vs "Elixir of Major Agility").
function findByBuffName(buffName: string, types: number[]) {
  // Shattrath flasks ("Pure Death of Shattrath") have the same effect as the normal flask.
  const shatt = buffName.match(/^(.*) of Shattrath$/)?.[1];
  const candidates = [buffName, `Elixir of ${buffName}`, `${buffName} Elixir`, ...(shatt ? [`Flask of ${shatt}`] : [])].map((n) =>
    n.toLowerCase(),
  );
  return consumables.find((c) => types.includes(c.type) && candidates.includes(c.name.toLowerCase()));
}

export interface ConsumeInput {
  buffs: { id: number; name: string; icon?: string }[];
  casts: { id: number; name: string; icon?: string }[];
  /** Scrolls on the player's pet (buff IDs); assumed: not seen on this fight. */
  petScrolls?: { id: number; assumed: boolean }[];
  mhTempEnchant?: number;
  ohTempEnchant?: number;
}

export interface DetectedConsumes {
  list: ConsumeUse[];
  /** WoWSims ConsumesSpec boolean fields. */
  flags: Partial<Record<Flag, boolean>>;
  conjuredId?: number;
  drums?: string;
}

export function detectConsumes(input: ConsumeInput): DetectedConsumes {
  const out: DetectedConsumes = { list: [], flags: {} };
  const seen = new Set<string>();
  // The icon of the buff or cast being looked at.
  let icon: string | undefined;
  const add = (category: ConsumeUse['category'], name: string, sim: { simId?: number; simulated?: boolean; assumed?: boolean } = {}) => {
    const key = `${category}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.list.push({ category, name, simId: sim.simId, simulated: sim.simulated ?? sim.simId !== undefined, ...(icon ? { icon } : {}), ...(sim.assumed ? { assumed: true } : {}) });
  };

  for (const b of input.buffs) {
    icon = b.icon;
    const flask = findByBuffName(b.name, [ConsumableType.Flask]);
    if (flask) add('Flask', flask.name, { simId: flask.id });
    const battle = findByBuffName(b.name, [ConsumableType.BattleElixir]);
    if (battle) add('Battle Elixir', battle.name, { simId: battle.id });
    const guardian = consumables.find((c) => c.id === ELIXIR_BUFFS[b.id]) ?? findByBuffName(b.name, [ConsumableType.GuardianElixir]);
    if (guardian) add('Guardian Elixir', guardian.name, { simId: guardian.id });
    if (b.name === 'Scourgebane Draught' || b.name === 'Scourgebane Infusion') add('Battle Elixir', b.name);
    if (OTHER_ELIXIRS[b.name] && !battle && !guardian) add(OTHER_ELIXIRS[b.name], b.name);
    if (/Stout|Brew|Ale|Drunk/.test(b.name) && !/Drums/.test(b.name) && b.name !== 'Dire Drunkard') add('Other', `Alcohol (${b.name})`);

    if (b.name === 'Well Fed') {
      const food = WELL_FED[b.id];
      add('Food', food?.name ?? `Well Fed (buff ${b.id})`, { simId: food?.simId });
    }
    if (SCROLLS[b.id]) {
      add('Scroll', SCROLLS[b.id].name, { simulated: true });
      out.flags[SCROLLS[b.id].sim] = true;
    }
    if (DRUMS[b.id]) {
      add('Drums', DRUMS[b.id].name, { simulated: true });
      out.drums = DRUMS[b.id].sim;
    }
    if (POTIONS[b.id]) add('Potion', POTIONS[b.id].name, { simId: POTIONS[b.id].simId });
  }

  // "Other": a log often doesn't show them (see collect.ts), so one missing isn't flagged.
  for (const s of input.petScrolls ?? []) {
    icon = PET_SCROLLS[s.id].icon;
    add('Other', PET_SCROLLS[s.id].name, { simulated: true, assumed: s.assumed });
    out.flags[PET_SCROLLS[s.id].sim] = true;
  }

  for (const c of input.casts) {
    icon = c.icon;
    if (POTIONS[c.id]) add('Potion', POTIONS[c.id].name, { simId: POTIONS[c.id].simId });
    const eng = ENGINEERING[c.id];
    if (eng) {
      if (typeof eng.sim === 'number') add('Engineering', eng.name, { simId: eng.sim });
      else {
        add('Engineering', eng.name, { simulated: !!eng.sim });
        if (eng.sim) out.flags[eng.sim] = true;
      }
    }
    const other = OTHER_CASTS[c.name];
    if (other) {
      add('Other', other.name, { simulated: !!(other.conjuredId || other.flag || other.simulated) });
      if (other.conjuredId) out.conjuredId = other.conjuredId;
      if (other.flag) out.flags[other.flag] = true;
    }
  }

  for (const [slot, effect] of [
    ['Weapon (MH)', input.mhTempEnchant],
    ['Weapon (OH)', input.ohTempEnchant],
  ] as const) {
    if (!effect || WINDFURY_TOTEM_ENCHANTS.has(effect) || SHAMAN_IMBUES[effect]) continue;
    const imbue = IMBUES[effect];
    icon = imbue?.icon;
    add(slot, imbue?.name ?? `Unknown (enchant ${effect})`, { simId: imbue?.simId });
  }

  return out;
}

export const tempEnchantName = (effect: number) =>
  WINDFURY_TOTEM_ENCHANTS.has(effect) ? 'Windfury Totem' : (IMBUES[effect]?.name ?? SHAMAN_IMBUES[effect]?.name);
