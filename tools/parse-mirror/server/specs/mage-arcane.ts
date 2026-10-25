import type { SpecConfig } from './types.ts';

export const mageArcane: SpecConfig = {
  key: 'mage-arcane',
  className: 'Mage',
  specName: 'Arcane',
  wcl: { classId: 4, specId: 1, actorType: 'Mage' },
  caster: true,
  // Arcane mages share a party with shadow priests, rarely with an Elemental shaman.
  totems: 'party',
  activityLabel: 'Time casting',
  gapThresholdSec: 0.75,

  trackedCasts: [
    { name: 'Arcane Blast', higherIsBetter: true },
    { name: 'Arcane Missiles', higherIsBetter: null },
    { name: 'Frostbolt', higherIsBetter: null },
    { name: 'Fireball', higherIsBetter: null },
    { name: 'Scorch', higherIsBetter: null },
    { name: 'Fire Blast', higherIsBetter: null },
    { name: 'Evocation', higherIsBetter: null },
  ],
  efficiency: [
    { name: 'Arcane Power', cooldownSec: 180 },
    { name: 'Presence of Mind', cooldownSec: 180 },
  ],
  // 16% spell hit against a level 73 boss; Arcane Focus adds 2% per point to Arcane spells.
  hit: { stat: 'hitSpell', perPct: 12.62, capPct: 16, talents: [{ name: 'Arcane Focus', pctPerPoint: 2 }] },
  gcdAbilities: ['Fire Blast', 'Arcane Explosion', 'Ice Lance', 'Cone of Cold', 'Frost Nova', 'Counterspell', 'Blink', 'Remove Lesser Curse', 'Slow', 'Ice Block'],
  channels: { 'Arcane Missiles': 5, Evocation: 8 },
  gcdSec: 1.5,
  cooldowns: [
    'Arcane Power',
    'Icy Veins',
    'Presence of Mind',
    'Cold Snap',
    'Berserking',
    'Arcane Torrent',
    'Destruction',
    'Restore Mana',
    'Replenish Mana',
    'Dark Rune',
    'Demonic Rune',
    'Blessing of the Silver Crescent',
    'Evocation',
  ],
  castLabels: { Destruction: 'Destruction Potion', 'Restore Mana': 'Super Mana Potion', 'Replenish Mana': 'Mana Emerald' },
  uptimes: ['Bloodlust', 'Drums of Battle', 'Power Infusion', 'Arcane Power', 'Icy Veins', 'Innervate'],
  expectedAbilities: [],

  // WoWSims preset, used when the armory has no matching spec.
  talentPresets: [{ name: 'Arcane', talents: '2500052300030150330125--053500031003001' }],

  sim: {
    specField: 'mage',
    // Armor self-buffs aren't in Anniversary logs; arcane mages run Mage Armor for the mana.
    specOptions: () => ({ options: { classOptions: { defaultMageArmor: 'MageArmorMageArmor' } } }),
    aplFile: 'mage-arcane.apl.json',
    notes: [
      'Talents come from the armory when the spec there matches the log; otherwise the WoWSims Arcane build.',
      "Mage Armor is assumed (self-buffs aren't in Anniversary logs). Mana from Innervate, Mana Tide and a party shadow priest's Vampiric Touch comes from the log.",
      'Arcane Power and Icy Veins are used at the time the player first used them in the log.',
    ],
    knockOn: 'Clearcasting and mana',
    timedCooldowns: [
      { spellId: 12042, name: 'Arcane Power' },
      // Keeps the APL's checks, so Cold Snap's second Icy Veins waits for the first to end.
      { spellId: 12472, name: 'Icy Veins', keepCondition: true },
    ],
    distanceFromTarget: 20,
    defaultRace: { horde: 'RaceBloodElf', alliance: 'RaceGnome' },
  },
};
