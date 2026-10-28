import type { SpecConfig } from './types.ts';

export const warriorFury: SpecConfig = {
  key: 'warrior-fury',
  className: 'Warrior',
  specName: 'Fury',
  wcl: { classId: 11, specId: 2, actorType: 'Warrior' },
  caster: false,
  activityLabel: 'GCD usage',
  gapThresholdSec: 3,

  trackedCasts: [
    { name: 'Bloodthirst', higherIsBetter: true },
    { name: 'Whirlwind', higherIsBetter: true },
    { name: 'Heroic Strike', higherIsBetter: null },
    { name: 'Cleave', higherIsBetter: null },
    { name: 'Execute', higherIsBetter: null },
    { name: 'Rampage', higherIsBetter: null },
    { name: 'Hamstring', higherIsBetter: null },
    { name: 'Slam', higherIsBetter: null },
    { name: 'Sunder Armor', higherIsBetter: null },
  ],
  efficiency: [
    { name: 'Bloodthirst', cooldownSec: 6 },
    { name: 'Whirlwind', cooldownSec: 10 },
  ],
  gcdAbilities: [
    'Bloodthirst',
    'Whirlwind',
    'Execute',
    'Hamstring',
    'Slam',
    'Rampage',
    'Sunder Armor',
    'Battle Shout',
    'Commanding Shout',
    'Demoralizing Shout',
    'Overpower',
    'Mortal Strike',
    'Intercept',
    'Thunder Clap',
  ],
  gcdSec: 1.5,
  cooldowns: ['Death Wish', 'Recklessness', 'Bloodrage', 'Berserker Rage', 'Blood Fury', 'Berserking', 'Haste', 'Insane Strength'],
  castLabels: { Haste: 'Haste Potion', 'Insane Strength': 'Insane Strength Potion' },
  uptimes: ['Flurry', 'Rampage', 'Death Wish', 'Recklessness', 'Bloodlust', 'Drums of Battle', 'Battle Shout'],
  expectedAbilities: ['Execute'],
  executeSpellId: 20647,
  rageFromDamageTaken: true,
  // Special attacks miss 8% against a level 73 boss in WoWSims (no extra 1% hit suppression, which
  // matches where top warriors stop). White hits while dual wielding never cap.
  hit: { stat: 'hitMelee', perPct: 15.77, capPct: 8, talents: [{ name: 'Precision', pctPerPoint: 1 }], whiteCapPct: 27 },
  // Weapon Mastery takes 1% per point off the boss's dodge: 4 expertise.
  expertise: { talents: [{ name: 'Weapon Mastery', perPoint: 4 }] },

  talentPresets: [
    // Top players (checked on the armory) run this with Booming Voice instead of Unbridled Wrath.
    { name: 'Fury', talents: '3400502130201-55000005505012050115' },
    { name: 'Arms - Kebab', talents: '34005021302010510321-0550000520501203' },
    { name: 'Arms', talents: '32005011352010500221-0550000500521203' },
  ],

  sim: {
    specField: 'dpsWarrior',
    specOptions: () => ({
      options: {
        classOptions: {
          queueDelay: 250,
          startingRage: 50,
          defaultShout: 'WarriorShoutBattle',
          defaultStance: 'WarriorStanceBerserker',
          hasBsT2: true,
          stanceSnapshot: true,
        },
      },
    }),
    aplFile: 'warrior-fury.apl.json',
    notes: [
      'Talents come from the armory when the spec there matches the log; otherwise the standard Fury build.',
      'The rotation is the WoWSims Fury APL with Recklessness on and Overpower weaving off, to match how top players play.',
      "In game, Recklessness also makes white hits crit; the sim doesn't. The luck analysis therefore counts some white crits during Recklessness as luck — that affects every warrior equally.",
    ],
    // The default APL has Recklessness switched off and weaves Overpower (with stance swaps).
    // Top players use Recklessness and don't Overpower, so match that.
    aplGroups: { enable: ['Recklessness ON/OFF'], disable: ['Overpower Weaving'] },
    // The APL pops Recklessness with Bloodlust on pull; real players mostly save it for later.
    knockOn: 'extra rage and Flurry',
    timedCooldowns: [{ spellId: 1719, name: 'Recklessness' }],
    distanceFromTarget: 25,
    defaultRace: { horde: 'RaceOrc', alliance: 'RaceHuman' },
  },
};
