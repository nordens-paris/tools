import { talentRank } from '../data/talents.ts';
import type { SpecConfig } from './types.ts';

export const warlockDestruction: SpecConfig = {
  key: 'warlock-destruction',
  className: 'Warlock',
  specName: 'Destruction',
  wcl: { classId: 10, specId: 3, actorType: 'Warlock' },
  caster: true,
  totems: 'raid',
  activityLabel: 'Time casting',
  gapThresholdSec: 0.75,

  trackedCasts: [
    { name: 'Shadow Bolt', higherIsBetter: true },
    { name: 'Incinerate', higherIsBetter: null },
    { name: 'Immolate', higherIsBetter: null },
    { name: 'Searing Pain', higherIsBetter: null },
    { name: 'Shadowburn', higherIsBetter: null },
    { name: 'Conflagrate', higherIsBetter: null },
    { name: 'Corruption', higherIsBetter: null },
    { name: 'Curse of Doom', higherIsBetter: null },
    { name: 'Curse of Agony', higherIsBetter: null },
    { name: 'Curse of the Elements', higherIsBetter: null },
    { name: 'Curse of Recklessness', higherIsBetter: null },
    { name: 'Life Tap', higherIsBetter: false },
  ],
  // Curse of Doom hits 60 s after the cast, so a cast in the last minute does nothing.
  efficiency: [{ name: 'Curse of Doom', cooldownSec: 60, delaySec: 60 }],
  // 16% spell hit against a level 73 boss. Suppression only helps Affliction spells.
  hit: { stat: 'hitSpell', perPct: 12.62, capPct: 16, talents: [] },
  gcdAbilities: [
    'Curse of Doom',
    'Curse of Agony',
    'Curse of the Elements',
    'Curse of Recklessness',
    'Curse of Tongues',
    'Life Tap',
    'Shadowburn',
    'Corruption',
    'Death Coil',
    'Conflagrate',
    'Siphon Life',
    'Dark Pact',
    'Amplify Curse',
  ],
  gcdSec: 1.5,
  cooldowns: ['Blood Fury', 'Berserking', 'Destruction', 'Restore Mana', 'Dark Rune', 'Blessing of the Silver Crescent', 'Dark Iron Pipeweed', 'Shadowburn', 'Inferno'],
  finishers: ['Shadowburn'],
  castLabels: { Destruction: 'Destruction Potion', 'Restore Mana': 'Super Mana Potion' },
  uptimes: ['Bloodlust', 'Drums of Battle', 'Power Infusion', 'Flameshadow', 'Shadowflame'],
  debuffUptimes: ['Curse of Doom', 'Curse of Agony', 'Curse of the Elements', 'Immolate', 'Corruption'],
  expectedAbilities: [],

  // WoWSims presets, used when the armory has no matching spec.
  talentPresets: [
    { name: 'Destruction', talents: '-20500301332101-50500051220051053105' },
    { name: 'Destro Nightfall', talents: '150222201023--505020510200510531051' },
    { name: 'Demo Ruin', talents: '01-205003213305010150134-50500251020001' },
  ],

  sim: {
    specField: 'warlock',
    specOptions: (raw, talents) => {
      const casts = new Map(raw.fight.casts.map((c) => [c.name, c.casts]));
      const curse = casts.get('Curse of the Elements')
        ? 'Elements'
        : casts.get('Curse of Recklessness')
          ? 'Recklessness'
          : casts.get('Curse of Doom')
            ? 'Doom'
            : 'Agony';
      // Self-buffs like Fel Armor and Demonic Sacrifice aren't recorded in Anniversary logs, so
      // assume Fel Armor, and Demonic Sacrifice up all fight if talented (an Infernal doesn't end it).
      const fireMain = (casts.get('Incinerate') ?? 0) > (casts.get('Shadow Bolt') ?? 0);
      const sacrifice = talentRank('Warlock', talents, 'Demonic Sacrifice') > 0;
      return {
        options: {
          classOptions: {
            summon: sacrifice || !raw.hasPet ? (fireMain ? 'Imp' : 'Succubus') : 'Imp',
            sacrificeSummon: sacrifice,
            armor: 'FelArmor',
            curseOptions: curse,
          },
        },
      };
    },
    // Fire warlocks (Incinerate) get WoWSims' fire rotation.
    aplFile: (raw) => {
      const casts = new Map(raw.fight.casts.map((c) => [c.name, c.casts]));
      return (casts.get('Incinerate') ?? 0) > (casts.get('Shadow Bolt') ?? 0) ? 'warlock-destro-fire.apl.json' : 'warlock-destruction.apl.json';
    },
    unmodeledDamage: ['Inferno', 'Immolation'],
    notes: [
      'Talents come from the armory when the spec there matches the log; otherwise a WoWSims preset with the same tree split.',
      'Fel Armor and Demonic Sacrifice don\'t show up in Anniversary logs, so Fel Armor is assumed, and Demonic Sacrifice is up all fight when talented.',
      "The sim doesn't summon an Infernal; Infernal damage is left out of real DPS for the execution score.",
    ],
    knockOn: 'Improved Shadow Bolt',
    distanceFromTarget: 30,
    defaultRace: { horde: 'RaceOrc', alliance: 'RaceHuman' },
  },
};
