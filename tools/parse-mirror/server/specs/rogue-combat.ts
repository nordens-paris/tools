import type { SpecConfig } from './types.ts';

// Top Combat rogues in Anniversary run 20/41/0 with swords: Sinister Strike, Slice and Dice, their
// own Expose Armor, Rupture and Eviscerate, Blade Flurry and Adrenaline Rush. Windfury Totem
// replaces the main-hand poison for most; Deadly Poison goes on the off-hand. WoWSims' Combat APL
// keeps Expose Armor up when Improved Expose Armor is talented; that's switched off for rogues who
// didn't use it in the log.
export const rogueCombat: SpecConfig = {
  key: 'rogue-combat',
  className: 'Rogue',
  specName: 'Combat',
  wcl: { classId: 8, specId: 2, actorType: 'Rogue' },
  caster: false,
  activityLabel: 'GCD usage',
  gapThresholdSec: 2,

  trackedCasts: [
    { name: 'Sinister Strike', higherIsBetter: true },
    { name: 'Slice and Dice', higherIsBetter: null },
    { name: 'Rupture', higherIsBetter: null },
    { name: 'Eviscerate', higherIsBetter: null },
    { name: 'Expose Armor', higherIsBetter: null },
    { name: 'Shiv', higherIsBetter: null },
    { name: 'Backstab', higherIsBetter: null },
  ],
  efficiency: [],
  gcdAbilities: ['Sinister Strike', 'Slice and Dice', 'Rupture', 'Eviscerate', 'Expose Armor', 'Shiv', 'Backstab', 'Hemorrhage', 'Feint'],
  gcdSec: 1,
  cooldowns: ['Adrenaline Rush', 'Blade Flurry', 'Blood Fury', 'Berserking', 'Arcane Torrent', 'Haste', 'Restore Energy'],
  castLabels: { Haste: 'Haste Potion', 'Restore Energy': 'Thistle Tea' },
  uptimes: ['Slice and Dice', 'Adrenaline Rush', 'Blade Flurry', 'Bloodlust', 'Drums of Battle'],
  debuffUptimes: ['Expose Armor', 'Rupture'],
  expectedAbilities: [],
  // Special attacks miss 8% against a level 73 boss in WoWSims; Precision adds 1% per point.
  hit: { stat: 'hitMelee', perPct: 15.77, capPct: 8, talents: [{ name: 'Precision', pctPerPoint: 1 }], whiteCapPct: 27 },
  expertise: { talents: [{ name: 'Weapon Expertise', perPoint: 5 }] },

  talentPresets: [{ name: 'Combat Swords', talents: '0053201252-023305200005015002321151' }],

  sim: {
    specField: 'rogue',
    specOptions: () => ({ options: { classOptions: {} } }),
    aplFile: 'rogue-combat.apl.json',
    aplVariables: (_gear, { used }) => (used.includes('Expose Armor') ? {} : { 'Imp EA Talented': { const: { val: 'false' } } }),
    // Your own Expose Armor comes from your rotation in the sim.
    selfProvided: ['Expose Armor'],
    timedCooldowns: [
      { spellId: 13750, name: 'Adrenaline Rush' },
      { spellId: 13877, name: 'Blade Flurry' },
    ],
    notes: [
      'Talents come from the armory when the spec there matches the log; otherwise the standard Combat Swords build.',
      'The rotation is the WoWSims Combat APL. It keeps your own Expose Armor up only if you used it in the log.',
      'Poisons come from your weapons in the log; with Windfury Totem on the main hand there is no main-hand poison, as in game. Adrenaline Rush and Blade Flurry are used when you used them.',
    ],
    knockOn: 'combo points, Sword Specialization',
    distanceFromTarget: 5,
    defaultRace: { horde: 'RaceOrc', alliance: 'RaceHuman' },
  },
};
