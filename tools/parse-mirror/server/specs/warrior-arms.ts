import { itemInfo } from '../data/db.ts';
import type { SpecConfig } from './types.ts';
import { warriorFury } from './warrior-fury.ts';

// Top Arms warriors in Anniversary dual wield swords with 33/28/0 ("Kebab": Mortal Strike plus
// Fury's dual-wield talents) and spam Heroic Strike, with Hamstring for extra Sword Specialization
// and Windfury procs; no Slam or Overpower. WoWSims' Arms APL has a dual-wield branch and a
// two-handed Slam branch, picked by Slam's cast time; here the weapons pick it, since a two-hander
// without Improved Slam (it happens) would otherwise get the dual-wield rotation.
export const warriorArms: SpecConfig = {
  ...warriorFury,
  key: 'warrior-arms',
  specName: 'Arms',
  wcl: { classId: 11, specId: 1, actorType: 'Warrior' },

  trackedCasts: [
    { name: 'Mortal Strike', higherIsBetter: true },
    { name: 'Whirlwind', higherIsBetter: true },
    { name: 'Heroic Strike', higherIsBetter: null },
    { name: 'Hamstring', higherIsBetter: null },
    { name: 'Slam', higherIsBetter: null },
    { name: 'Execute', higherIsBetter: null },
    { name: 'Overpower', higherIsBetter: null },
    { name: 'Cleave', higherIsBetter: null },
    { name: 'Sweeping Strikes', higherIsBetter: null },
    { name: 'Sunder Armor', higherIsBetter: null },
  ],
  efficiency: [
    { name: 'Mortal Strike', cooldownSec: 6 },
    { name: 'Whirlwind', cooldownSec: 10 },
  ],
  gcdAbilities: [...warriorFury.gcdAbilities, 'Sweeping Strikes'],
  cooldowns: ['Death Wish', 'Recklessness', 'Sweeping Strikes', 'Bloodrage', 'Berserker Rage', 'Blood Fury', 'Berserking', 'Haste', 'Insane Strength', 'Dire Drunkard'],
  uptimes: ['Flurry', 'Death Wish', 'Recklessness', 'Bloodlust', 'Drums of Battle', 'Battle Shout'],
  debuffUptimes: ['Mortal Strike'],
  expectedAbilities: ['Execute'],

  talentPresets: [
    { name: 'Arms - Kebab', talents: '34005021302010510321-0550000520501203' },
    { name: 'Arms', talents: '32005011352010500221-0550000500521203' },
    { name: 'Fury', talents: '3400502130201-55000005505012050115' },
  ],

  sim: {
    ...warriorFury.sim,
    aplFile: 'warrior-arms.apl.json',
    aplVariables: (gear) => {
      // An off-hand weapon (not a held-in-off-hand item or a shield) means dual wielding.
      const oh = gear[16]?.id ? itemInfo(gear[16].id) : undefined;
      const dualWield = !!oh?.w && oh.w !== 7;
      return { '2H Arms': { const: { val: String(!dualWield) } }, 'DW Arms': { const: { val: String(dualWield) } } };
    },
    notes: [
      'Talents come from the armory when the spec there matches the log; otherwise the Kebab build (dual-wield Arms), or WoWSims’ two-handed Arms build for a closer tree split.',
      'The rotation is the WoWSims Arms APL with Recklessness on and Overpower weaving off, to match how top players play. With two weapons it spams Heroic Strike and uses Hamstring between Mortal Strikes; with a two-hander it weaves Slam.',
      "In game, Recklessness also makes white hits crit; the sim doesn't. The luck analysis therefore counts some white crits during Recklessness as luck — that affects every warrior equally.",
    ],
    // Blood Frenzy comes from your own Mortal Strikes in the sim (the talent), not as a raid debuff.
    selfProvided: ['Mortal Strike', 'Blood Frenzy'],
  },
};
