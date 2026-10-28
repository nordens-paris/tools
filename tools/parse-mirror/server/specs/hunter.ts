import type { PlayerFightRaw } from '../analysis/collect.ts';
import type { SpecConfig } from './types.ts';

// Hunters are one spec in WoWSims, set apart by talents; Warcraft Logs ranks Beast Mastery,
// Marksmanship and Survival separately, so each gets a module built from this base. Top hunters
// in Anniversary all play much the same: Auto Shot, Steady Shot, Kill Command, Multi-Shot and Arcane
// Shot, with Raptor Strike melee weaving for Beast Mastery and Survival.
// Logs show neither ammo nor quiver, and aspects aren't logged. Top hunters' Auto Shots hit 6%
// harder than with WoWSims' default Warden's Arrow (Steady Shot, which ignores ammo, only 2%), so the
// best arrow available before Sunwell, Mysterious Arrow, is assumed, with a 15% quiver.

/** The pet the sim gets: its family from the abilities it used (Ravager when there was no pet to tell). */
function petOptions(raw: PlayerFightRaw) {
  const pet = raw.fight.pets?.find((p) => p.kind === 'pet');
  return {
    petType: pet?.family ?? (raw.hasPet || !raw.fight.pets ? 'Ravager' : 'PetNone'),
    petUptime: pet?.uptimePct !== undefined ? Math.round(pet.uptimePct) / 100 : 1,
    petSingleAbility: false,
  };
}

const hunterBase: Omit<SpecConfig, 'key' | 'specName' | 'wcl' | 'talentPresets'> = {
  className: 'Hunter',
  caster: false,
  activityLabel: 'GCD usage',
  gapThresholdSec: 2,
  petUptime: true,

  trackedCasts: [
    { name: 'Steady Shot', higherIsBetter: true },
    { name: 'Auto Shot', higherIsBetter: true },
    { name: 'Kill Command', higherIsBetter: true },
    { name: 'Multi-Shot', higherIsBetter: null },
    { name: 'Arcane Shot', higherIsBetter: null },
    { name: 'Raptor Strike', higherIsBetter: null },
    { name: 'Aimed Shot', higherIsBetter: null },
    { name: 'Serpent Sting', higherIsBetter: null },
  ],
  efficiency: [{ name: 'Kill Command', cooldownSec: 5 }],
  gcdAbilities: ['Arcane Shot', 'Multi-Shot', 'Serpent Sting', "Hunter's Mark", 'Aspect of the Hawk', 'Aspect of the Viper', 'Misdirection', 'Volley'],
  gcdSec: 1.5,
  cooldowns: ['Bestial Wrath', 'Rapid Fire', 'Readiness', 'Blood Fury', 'Berserking', 'Haste', 'Restore Mana'],
  castLabels: { Haste: 'Haste Potion', 'Restore Mana': 'Super Mana Potion' },
  uptimes: ['Rapid Fire', 'The Beast Within', 'Quick Shots', 'Bloodlust', 'Drums of Battle'],
  expectedAbilities: [],
  // Ranged special shots miss 8% against a level 73 boss in WoWSims; Surefooted adds 1% per point.
  hit: { stat: 'hitRanged', perPct: 15.77, capPct: 8, talents: [{ name: 'Surefooted', pctPerPoint: 1 }] },

  sim: {
    specField: 'hunter',
    specOptions: (raw) => ({ options: { classOptions: { quiverBonus: 'Speed15', ammo: 'MysteriousArrow', ...petOptions(raw) } } }),
    aplFile: 'hunter.apl.json',
    aplVariables: (_gear, { used }) => ({
      'Melee weave': { const: { val: String(used.includes('Raptor Strike')) } },
      'Use Multi-Shot': { const: { val: String(used.includes('Multi-Shot')) } },
      'Use Arcane Shot': { const: { val: String(used.includes('Arcane Shot')) } },
    }),
    // WoWSims uses these at 5 s; real hunters line them up with Bloodlust or later.
    timedCooldowns: [
      { spellId: 19574, name: 'Bestial Wrath' },
      { spellId: 3045, name: 'Rapid Fire' },
    ],
    notes: [
      'Talents come from the armory when the spec there matches the log; otherwise a WoWSims hunter build with the closest tree split.',
      'The rotation is the WoWSims hunter APL: Steady Shot between Auto Shots, Kill Command on cooldown, with Multi-Shot, Arcane Shot and Raptor Strike melee weaving only if you used them.',
      'Logs don’t show ammo or quiver: Mysterious Arrow and a 15% quiver are assumed (what top hunters’ Auto Shots fit). Your pet’s family comes from its abilities, and its uptime from how long it was attacking in the log.',
      'Bestial Wrath and Rapid Fire are used when you used them in the log.',
    ],
    knockOn: 'Improved Aspect of the Hawk, Ferocious Inspiration',
    distanceFromTarget: 20,
    defaultRace: { horde: 'RaceOrc', alliance: 'RaceDraenei' },
  },
};

// WoWSims' Beast Mastery and Survival builds; it has no Marksmanship one, so those are top
// Marksmanship players' builds from the armory (October 2026). The closest tree split is used.
const PRESETS = [
  { name: 'Beast Mastery', talents: '522002005150122431051-0505201205' },
  { name: 'Survival', talents: '502-0550201205-333200022003223005103' },
  { name: 'Marksmanship', talents: '502-0555201205013253135-33' },
  { name: 'Marksmanship (Survival)', talents: '502-05152012050132531051-33220002' },
  { name: 'Marksmanship (Beast Mastery)', talents: '51200200503-0505211205013253105-0002' },
];

export const hunterBeastMastery: SpecConfig = {
  ...hunterBase,
  key: 'hunter-beast-mastery',
  specName: 'BeastMastery',
  wcl: { classId: 3, specId: 1, actorType: 'Hunter' },
  talentPresets: PRESETS,
};

export const hunterMarksmanship: SpecConfig = {
  ...hunterBase,
  key: 'hunter-marksmanship',
  specName: 'Marksmanship',
  wcl: { classId: 3, specId: 2, actorType: 'Hunter' },
  talentPresets: [PRESETS[2], ...PRESETS.filter((_, i) => i !== 2)],
};

export const hunterSurvival: SpecConfig = {
  ...hunterBase,
  key: 'hunter-survival',
  specName: 'Survival',
  wcl: { classId: 3, specId: 3, actorType: 'Hunter' },
  debuffUptimes: ['Expose Weakness'],
  talentPresets: [PRESETS[1], PRESETS[0]],
  sim: {
    ...hunterBase.sim,
    // The sim applies your own Expose Weakness from your crits.
    selfProvided: ['Expose Weakness'],
  },
};
