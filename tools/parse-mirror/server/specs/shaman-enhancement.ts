import { shamanImbueOf } from '../data/consumes.ts';
import type { SpecConfig } from './types.ts';

// The weapon's imbue from the log. With nothing on it (or the party's Windfury Totem, which hides
// the shaman's own), assume Windfury Weapon; an oil or stone means no imbue.
const WINDFURY_TOTEM_ENCHANT = 2639;
const imbueOf = (effect?: number) => shamanImbueOf(effect) ?? (effect && effect !== WINDFURY_TOTEM_ENCHANT ? 'NoImbue' : 'WindfuryWeapon');

// Top Enhancement shamans in Anniversary dual wield axes with Windfury Weapon on both, twist
// Windfury Totem and Grace of Air, and use Stormstrike, Earth and Flame Shock and Shamanistic Rage.
// WoWSims' Enhancement APL twists and drops its own Strength of Earth and Mana Spring, so those
// totems stay out of the raid environment (they'd stack with the sim's own). "Windfury Attack" is
// also what Windfury Weapon's procs are called, so it can't show a party Windfury Totem here.
export const shamanEnhancement: SpecConfig = {
  key: 'shaman-enhancement',
  className: 'Shaman',
  specName: 'Enhancement',
  wcl: { classId: 9, specId: 2, actorType: 'Shaman' },
  caster: false,
  totems: 'party',
  activityLabel: 'GCD usage',
  gapThresholdSec: 3,

  trackedCasts: [
    { name: 'Stormstrike', higherIsBetter: true },
    { name: 'Earth Shock', higherIsBetter: null },
    { name: 'Flame Shock', higherIsBetter: null },
    { name: 'Frost Shock', higherIsBetter: null },
    { name: 'Windfury Totem', higherIsBetter: null },
    { name: 'Grace of Air Totem', higherIsBetter: null },
    { name: 'Fire Nova Totem', higherIsBetter: null },
    { name: 'Magma Totem', higherIsBetter: null },
    { name: 'Searing Totem', higherIsBetter: null },
  ],
  efficiency: [{ name: 'Stormstrike', cooldownSec: 10 }],
  // Stormstrike logs a cast for each weapon's hit as well; 17364 is the cast.
  castIds: { Stormstrike: 17364 },
  // Windfury Weapon's extra attacks are "Windfury Attack" in the log, "Windfury Weapon" in the sim.
  outcomeAliases: { 'Windfury Attack': 'Windfury Weapon' },
  gcdAbilities: [
    'Stormstrike',
    'Earth Shock',
    'Flame Shock',
    'Frost Shock',
    'Windfury Totem',
    'Grace of Air Totem',
    'Strength of Earth Totem',
    'Mana Spring Totem',
    'Fire Nova Totem',
    'Magma Totem',
    'Searing Totem',
    'Fire Elemental Totem',
    'Healing Stream Totem',
    'Lightning Shield',
    'Water Shield',
    'Bloodlust',
    'Heroism',
  ],
  gcdSec: 1.5,
  cooldowns: ['Shamanistic Rage', 'Bloodlust', 'Heroism', 'Fire Elemental Totem', 'Blood Fury', 'Berserking', 'Haste', 'Insane Strength'],
  castLabels: { Haste: 'Haste Potion', 'Insane Strength': 'Insane Strength Potion' },
  uptimes: ['Flurry', 'Shamanistic Rage', 'Bloodlust', 'Heroism', 'Drums of Battle'],
  debuffUptimes: ['Flame Shock'],
  expectedAbilities: [],
  // Special attacks miss 8% against a level 73 boss in WoWSims. Dual Wield Specialization adds 2%
  // per point, Nature's Guidance 1%.
  hit: {
    stat: 'hitMelee',
    perPct: 15.77,
    capPct: 8,
    talents: [
      { name: 'Dual Wield Specialization', pctPerPoint: 2 },
      { name: "Nature's Guidance", pctPerPoint: 1 },
    ],
    whiteCapPct: 27,
  },
  expertise: { talents: [] },

  talentPresets: [
    { name: 'Enhancement', talents: '03-500502210501133531151-50005301' },
    { name: 'Enhancement (Elemental)', talents: '250031501-500503210500133531151' },
  ],

  sim: {
    specField: 'enhancementShaman',
    specOptions: (raw) => ({
      options: {
        classOptions: { imbueMh: imbueOf(raw.combatant?.gear[15]?.temporaryEnchant) },
        imbueOh: imbueOf(raw.combatant?.gear[16]?.temporaryEnchant),
        syncType: 'DelayOffhandSwings',
      },
    }),
    aplFile: 'shaman-enhancement.apl.json',
    excludeBuffs: ['Windfury Attack', 'Windfury Totem', 'Grace of Air', 'Strength of Earth', 'Mana Spring'],
    timedCooldowns: [{ spellId: 2894, name: 'Fire Elemental Totem', pet: 'Fire Elemental Totem' }],
    notes: [
      'Talents come from the armory when the spec there matches the log; otherwise the standard Enhancement build.',
      'The rotation is the WoWSims Enhancement APL: Windfury and Grace of Air twisting, Stormstrike, shocks and fire totems. It drops your own Strength of Earth and Mana Spring, so other shamans’ totems of those kinds aren’t added on top.',
      'Weapon imbues come from your weapons in the log (Windfury Weapon when the log doesn’t show one). Fire Elemental is used if you had one out; Bloodlust when it went up in the log.',
    ],
    knockOn: 'Flurry, Windfury',
    distanceFromTarget: 5,
    defaultRace: { horde: 'RaceOrc', alliance: 'RaceDraenei' },
  },
};
