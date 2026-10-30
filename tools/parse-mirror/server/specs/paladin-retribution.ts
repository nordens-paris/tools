import type { SpecConfig } from './types.ts';

// Top Retribution paladins in Anniversary run 5/11/45 with a two-hander: seal twisting (Seal of
// Command into Seal of Blood, or Seal of the Martyr for the Alliance) around Crusader Strike and
// Judgement, Avenging Wrath once, some Exorcism and Consecration. WoWSims' Retribution APL twists
// the same way; its Exorcism, Consecration and pre-pull Judgement of the Crusader switches are set
// from the log.
export const paladinRetribution: SpecConfig = {
  key: 'paladin-retribution',
  className: 'Paladin',
  specName: 'Retribution',
  wcl: { classId: 6, specId: 3, actorType: 'Paladin' },
  caster: false,
  activityLabel: 'GCD usage',
  gapThresholdSec: 3,

  trackedCasts: [
    { name: 'Crusader Strike', higherIsBetter: true },
    { name: 'Judgement', higherIsBetter: true },
    { name: 'Seal of Command', higherIsBetter: null },
    { name: 'Seal of Blood', higherIsBetter: null },
    { name: 'Seal of the Martyr', higherIsBetter: null },
    { name: 'Seal of the Crusader', higherIsBetter: null },
    { name: 'Exorcism', higherIsBetter: null },
    { name: 'Consecration', higherIsBetter: null },
    { name: 'Hammer of Wrath', higherIsBetter: null },
  ],
  efficiency: [
    { name: 'Crusader Strike', cooldownSec: 6 },
    // Improved Judgement takes the cooldown to 8 s.
    { name: 'Judgement', cooldownSec: 8 },
  ],
  // Seal of Command's procs are logged as casts too; only the seal itself counts.
  castIds: { 'Seal of Command': 20375 },
  // The sim twists Seal of Blood for everyone; the Alliance version's damage is the same.
  outcomeAliases: { 'Seal of the Martyr': 'Seal of Blood', 'Judgement of the Martyr': 'Judgement of Blood' },
  gcdAbilities: [
    'Crusader Strike',
    'Seal of Command',
    'Seal of Blood',
    'Seal of the Martyr',
    'Seal of the Crusader',
    'Seal of Wisdom',
    'Seal of Light',
    'Exorcism',
    'Consecration',
    'Hammer of Wrath',
    'Blessing of Might',
    'Blessing of Kings',
    'Greater Blessing of Might',
    'Greater Blessing of Kings',
  ],
  gcdSec: 1.5,
  cooldowns: ['Avenging Wrath', 'Blood Fury', 'Berserking', 'Arcane Torrent', 'Haste', 'Insane Strength', 'Dire Drunkard'],
  castLabels: { 'Dire Drunkard': 'Empty Mug of Direbrew', Haste: 'Haste Potion', 'Insane Strength': 'Insane Strength Potion' },
  uptimes: ['Avenging Wrath', 'Vengeance', 'Bloodlust', 'Drums of Battle'],
  debuffUptimes: ['Judgement of the Crusader'],
  expectedAbilities: [],
  // Special attacks miss 8% against a level 73 boss in WoWSims; Precision adds 1% per point.
  hit: { stat: 'hitMelee', perPct: 15.77, capPct: 8, talents: [{ name: 'Precision', pctPerPoint: 1 }] },
  expertise: { talents: [{ name: 'Combat Expertise', perPoint: 1 }] },

  talentPresets: [
    { name: 'Retribution', talents: '5-053201-0523005120033125331051' },
    { name: 'Retribution (no Precision)', talents: '5-0532-0523005130033125331051' },
  ],

  sim: {
    specField: 'retributionPaladin',
    specOptions: () => ({ options: { classOptions: {} } }),
    aplFile: 'paladin-retribution.apl.json',
    aplVariables: (_gear, { used, ownAuras }) => ({
      'Use Exorcism': { const: { val: String(used.includes('Exorcism')) } },
      'Use Consecrate': { const: { val: String(used.includes('Consecration')) } },
      'Prepull Seal Of the Crusader': { const: { val: String(ownAuras.includes('Judgement of the Crusader')) } },
    }),
    // The sim puts up its own Sanctity Aura. Judgement of the Crusader stays as the log had it: the
    // sim only judges it before the pull, while many Rets keep it up all fight.
    selfProvided: ['Sanctity Aura'],
    timedCooldowns: [{ spellId: 31884, name: 'Avenging Wrath' }],
    notes: [
      'Talents come from the armory when the spec there matches the log; otherwise the standard Retribution build.',
      'The rotation is the WoWSims Retribution APL: Seal of Command twisted into Seal of Blood (Seal of the Martyr for the Alliance) around Crusader Strike and Judgement. Exorcism and Consecration are used only if you used them. Judgement of the Crusader is on the boss as long as it was in the log.',
      'Avenging Wrath is used when you used it in the log.',
    ],
    knockOn: 'Vengeance',
    distanceFromTarget: 5,
    defaultRace: { horde: 'RaceBloodElf', alliance: 'RaceHuman' },
  },
};
