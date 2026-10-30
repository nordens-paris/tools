import type { SpecConfig } from './types.ts';

// Top Feral cats in Anniversary powershift (Cat Form 11-13 times a minute) and Shred, with Rip and
// Ferocious Bite; Mangle usually comes from a bear. WoWSims' cat APL powershifts the same way and
// only casts Mangle or Faerie Fire when the boss doesn't have them, so the player's own are left
// out of the raid environment. Leader of the Pack is set by the sim's druid itself.
export const druidFeral: SpecConfig = {
  key: 'druid-feral',
  className: 'Druid',
  specName: 'Feral',
  wcl: { classId: 2, specId: 2, actorType: 'Druid' },
  caster: false,
  activityLabel: 'GCD usage',
  gapThresholdSec: 2,

  trackedCasts: [
    { name: 'Shred', higherIsBetter: true },
    { name: 'Mangle (Cat)', higherIsBetter: null },
    { name: 'Rip', higherIsBetter: null },
    { name: 'Ferocious Bite', higherIsBetter: null },
    { name: 'Cat Form', higherIsBetter: null },
    { name: 'Rake', higherIsBetter: null },
    { name: 'Faerie Fire (Feral)', higherIsBetter: null },
  ],
  efficiency: [],
  gcdAbilities: ['Shred', 'Mangle (Cat)', 'Rip', 'Ferocious Bite', 'Rake', 'Faerie Fire (Feral)', 'Cat Form', "Tiger's Fury"],
  gcdSec: 1,
  cooldowns: ['Haste', 'Insane Strength', 'Blood Fury', 'Berserking', 'Innervate', 'Dire Drunkard'],
  castLabels: { 'Dire Drunkard': 'Empty Mug of Direbrew', Haste: 'Haste Potion', 'Insane Strength': 'Insane Strength Potion' },
  uptimes: ['Clearcasting', 'Bloodlust', 'Drums of Battle'],
  debuffUptimes: ['Rip', 'Mangle (Cat)'],
  expectedAbilities: [],
  // Special attacks miss 8% against a level 73 boss in WoWSims; no feral talent adds hit.
  hit: { stat: 'hitMelee', perPct: 15.77, capPct: 8, talents: [] },
  expertise: { talents: [] },

  talentPresets: [
    { name: 'Cat', talents: '-503032132322105301251-05503301' },
    { name: 'Cat (Furor)', talents: '-553002132322105301051-05503301' },
  ],

  sim: {
    specField: 'feralCatDruid',
    specOptions: () => ({ options: { classOptions: {}, cannotShredTarget: false } }),
    aplFile: 'druid-feral.apl.json',
    selfProvided: ['Leader of the Pack', 'Mangle (Cat)', 'Faerie Fire (Feral)'],
    notes: [
      'Talents come from the armory when the spec there matches the log; otherwise the standard cat build.',
      'The rotation is the WoWSims cat APL with powershifting. It casts Mangle and Faerie Fire itself only when the boss doesn’t have them from someone else.',
    ],
    knockOn: 'combo points, Omen of Clarity',
    distanceFromTarget: 5,
    defaultRace: { horde: 'RaceTauren', alliance: 'RaceNightElf' },
  },
};
