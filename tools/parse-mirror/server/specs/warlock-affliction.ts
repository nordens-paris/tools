import { talentRank } from '../data/talents.ts';
import type { SpecConfig } from './types.ts';
import { curseOf, demonOf } from './warlock-common.ts';
import { warlockDestruction } from './warlock-destruction.ts';

// Most top "Affliction" warlocks in Anniversary play 40/0/21: Shadow Bolt with Corruption, a curse
// and a pet out (Improved Shadow Bolt and Ruin from the Destruction tree), often without Siphon Life
// and never Immolate or Unstable Affliction. WoWSims' Affliction APL keeps every DoT up, so DoTs the
// player didn't use are switched off (sim.onlyIfCast).
export const warlockAffliction: SpecConfig = {
  ...warlockDestruction,
  key: 'warlock-affliction',
  specName: 'Affliction',
  wcl: { classId: 10, specId: 1, actorType: 'Warlock' },

  trackedCasts: [
    { name: 'Shadow Bolt', higherIsBetter: true },
    { name: 'Corruption', higherIsBetter: null },
    { name: 'Siphon Life', higherIsBetter: null },
    { name: 'Unstable Affliction', higherIsBetter: null },
    { name: 'Curse of Agony', higherIsBetter: null },
    { name: 'Curse of Doom', higherIsBetter: null },
    { name: 'Curse of the Elements', higherIsBetter: null },
    { name: 'Curse of Recklessness', higherIsBetter: null },
    { name: 'Immolate', higherIsBetter: null },
    { name: 'Seed of Corruption', higherIsBetter: null },
    { name: 'Shadowburn', higherIsBetter: null },
    { name: 'Life Tap', higherIsBetter: false },
  ],
  efficiency: [],
  gcdAbilities: [...warlockDestruction.gcdAbilities.filter((n) => n !== 'Conflagrate'), 'Unstable Affliction'],
  uptimes: ['Bloodlust', 'Drums of Battle', 'Power Infusion', 'Shadow Trance'],
  debuffUptimes: ['Corruption', 'Siphon Life', 'Unstable Affliction', 'Curse of Agony', 'Curse of Doom', 'Curse of the Elements', 'Immolate'],

  talentPresets: [
    // WoWSims' Affliction build is the 40/0/21 Shadow Bolt build above; its Destruction builds are
    // there for a closer split. The armory has most players' real talents.
    { name: 'Affliction', talents: '05022221112351055003--50500051220001' },
    { name: 'Destro Nightfall', talents: '150222201023--505020510200510531051' },
    { name: 'Destruction', talents: '-20500301332101-50500051220051053105' },
  ],

  sim: {
    ...warlockDestruction.sim,
    specOptions: (raw, talents) => {
      const sacrifice = talentRank('Warlock', talents, 'Demonic Sacrifice') > 0;
      return {
        options: {
          classOptions: {
            summon: demonOf(raw) ?? 'Imp',
            sacrificeSummon: sacrifice,
            armor: 'FelArmor',
            curseOptions: curseOf(raw),
          },
        },
      };
    },
    aplFile: 'warlock-affliction.apl.json',
    onlyIfCast: [
      { spellId: 27215, name: 'Immolate' },
      { spellId: 30405, name: 'Unstable Affliction' },
      { spellId: 27216, name: 'Corruption' },
      { spellId: 30911, name: 'Siphon Life' },
    ],
    notes: [
      'Talents come from the armory when the spec there matches the log; otherwise a WoWSims preset with the same tree split.',
      "Fel Armor doesn't show up in Anniversary logs, so it's assumed. The demon is the one you had out in the log.",
      'The rotation is the WoWSims Affliction APL, keeping only the damage over time spells you used (most top players skip Immolate and Unstable Affliction).',
      "The sim doesn't summon an Infernal; Infernal damage is left out of real DPS for the execution score.",
    ],
  },
};
