import type { SpecConfig } from './types.ts';

// Top Elemental shamans in Anniversary run 41/0/20: Lightning Bolt with Chain Lightning on
// cooldown when mana allows, Elemental Mastery, and their own totems dropped before the pull (not
// in the log). WoWSims' Elemental APL drops the same totems before the pull, so the raid
// environment leaves totems out for them: its own Totem of Wrath would stack with a raid one.
export const shamanElemental: SpecConfig = {
  key: 'shaman-elemental',
  className: 'Shaman',
  specName: 'Elemental',
  wcl: { classId: 9, specId: 1, actorType: 'Shaman' },
  caster: true,
  totems: 'party',
  activityLabel: 'Time casting',
  gapThresholdSec: 0.75,

  trackedCasts: [
    { name: 'Lightning Bolt', higherIsBetter: true },
    { name: 'Chain Lightning', higherIsBetter: true },
    { name: 'Earth Shock', higherIsBetter: null },
    { name: 'Flame Shock', higherIsBetter: null },
    { name: 'Frost Shock', higherIsBetter: null },
    { name: 'Searing Totem', higherIsBetter: null },
    { name: 'Totem of Wrath', higherIsBetter: null },
    { name: 'Water Shield', higherIsBetter: null },
  ],
  efficiency: [],
  // 16% spell hit against a level 73 boss: Elemental Precision (fire, frost and nature) 2% per
  // point, Nature's Guidance 1% per point, and their own Totem of Wrath 3%.
  hit: {
    stat: 'hitSpell',
    perPct: 12.62,
    capPct: 16,
    talents: [
      { name: 'Elemental Precision', pctPerPoint: 2 },
      { name: "Nature's Guidance", pctPerPoint: 1 },
      { name: 'Totem of Wrath', pctPerPoint: 3 },
    ],
  },
  gcdAbilities: [
    'Earth Shock',
    'Flame Shock',
    'Frost Shock',
    'Bloodlust',
    'Heroism',
    'Totem of Wrath',
    'Wrath of Air Totem',
    'Mana Spring Totem',
    'Strength of Earth Totem',
    'Searing Totem',
    'Fire Elemental Totem',
    'Earth Elemental Totem',
    'Water Shield',
    'Grounding Totem',
    'Tremor Totem',
  ],
  gcdSec: 1.5,
  cooldowns: ['Elemental Mastery', 'Bloodlust', 'Heroism', 'Fire Elemental Totem', 'Earth Elemental Totem', 'Blood Fury', 'Berserking', 'Destruction', 'Restore Mana', 'Dark Rune', 'Demonic Rune', 'Blessing of the Silver Crescent', 'Dark Iron Pipeweed'],
  castLabels: { Destruction: 'Destruction Potion', 'Restore Mana': 'Super Mana Potion', 'Dark Iron Pipeweed': 'Dark Iron Smoking Pipe' },
  uptimes: ['Bloodlust', 'Heroism', 'Drums of Battle', 'Power Infusion', 'Elemental Mastery', 'Clearcasting'],
  expectedAbilities: [],

  talentPresets: [
    { name: 'Elemental', talents: '55003105100213351051--05105301005' },
  ],

  sim: {
    specField: 'elementalShaman',
    // Water Shield comes from the APL; Elementals put Wizard Oil on the weapon, not an imbue.
    specOptions: () => ({ options: { classOptions: { imbueMh: 'NoImbue' } } }),
    aplFile: 'shaman-elemental.apl.json',
    // Fire Elemental is usually dropped before the pull, so it's found from the pet, not the cast.
    aplVariables: (_gear, { used }) => ({
      'Use Fire Elemental': { const: { val: String(used.includes('Fire Elemental Totem')) } },
      'Use Earth Elemental': { const: { val: String(used.includes('Earth Elemental Totem')) } },
    }),
    excludeBuffs: ['Totem of Wrath', 'Wrath of Air Totem', 'Mana Spring', 'Strength of Earth'],
    // WoWSims uses the elementals as cooldowns on its own at the pull, whatever the APL says; these
    // go when the player's did (at the pull if one was already out), or never.
    timedCooldowns: [
      { spellId: 2894, name: 'Fire Elemental Totem', pet: 'Fire Elemental Totem' },
      { spellId: 2062, name: 'Earth Elemental Totem', pet: 'Earth Elemental Totem' },
    ],
    notes: [
      'Talents come from the armory when the spec there matches the log; otherwise the standard Elemental build.',
      'The rotation is the WoWSims Elemental APL. It drops your own totems (Totem of Wrath, Wrath of Air, Mana Spring, Strength of Earth) before the pull, so other shamans’ totems aren’t added on top.',
      'Fire Elemental is used if you had one out in the log (at the pull if it was dropped before). The sim’s elemental melees all the time, so it does more than a real one (about 350 vs 190 DPS on top players); that’s the same for everyone who uses it. Bloodlust is used when it went up in the log.',
    ],
    knockOn: 'Lightning Overload, Clearcasting',
    distanceFromTarget: 30,
    defaultRace: { horde: 'RaceTroll', alliance: 'RaceDraenei' },
  },
};
