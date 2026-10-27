// Tank specs in the DPS spec format, for the tank sims only (they aren't DPS specs a visitor can
// analyze). This lets the tank sims reuse the DPS fight collector (gear, race, armory talents, raid
// buffs) and request builder. Talents, options and rotations are WoWSims' own tank presets.
import { tankSpecs } from './tanks.ts';
import type { SpecConfig } from './types.ts';

const gcdOf = (className: string) => tankSpecs.find((t) => t.className === className)!.gcd;

const tankSim = (spec: Omit<SpecConfig, 'caster' | 'activityLabel' | 'gapThresholdSec' | 'trackedCasts' | 'efficiency' | 'castLabels' | 'uptimes' | 'expectedAbilities' | 'gcdSec'>): SpecConfig => ({
  caster: false,
  activityLabel: 'GCD usage',
  gapThresholdSec: 3,
  trackedCasts: [],
  efficiency: [],
  castLabels: {},
  uptimes: [],
  expectedAbilities: [],
  gcdSec: 1.5,
  ...spec,
});

export const tankSimSpecs: Record<string, SpecConfig> = {
  Warrior: tankSim({
    key: 'warrior-protection',
    className: 'Warrior',
    specName: 'Protection',
    wcl: { classId: 11, specId: 3, actorType: 'Warrior' },
    gcdAbilities: gcdOf('Warrior'),
    cooldowns: ['Shield Wall', 'Last Stand', 'Shield Block', 'Bloodrage'],
    rageFromDamageTaken: true,
    hit: { stat: 'hitMelee', perPct: 15.77, capPct: 9, talents: [{ name: 'Precision', pctPerPoint: 1 }] },
    talentPresets: [{ name: 'Protection', talents: '35000301302-03-0055511033001101501351' }],
    sim: {
      specField: 'protectionWarrior',
      // The tank's own shout: Battle Shout if they kept it up themselves, otherwise Commanding.
      // No starting rage: Bloodrage before the pull is in the rotation.
      specOptions: (raw) => ({
        options: {
          classOptions: {
            startingRage: 0,
            queueDelay: 250,
            defaultStance: 'WarriorStanceDefensive',
            defaultShout: raw.fight.casts.some((c) => c.name === 'Battle Shout') ? 'WarriorShoutBattle' : 'WarriorShoutCommanding',
          },
        },
      }),
      aplFile: 'warrior-protection.apl.json',
      notes: ['The rotation is the WoWSims Protection Warrior APL, with no starting rage (Bloodrage before the pull is in it).'],
      distanceFromTarget: 5,
      defaultRace: { horde: 'RaceOrc', alliance: 'RaceHuman' },
    },
  }),
  Paladin: tankSim({
    key: 'paladin-protection',
    className: 'Paladin',
    specName: 'Protection',
    wcl: { classId: 6, specId: 2, actorType: 'Paladin' },
    gcdAbilities: gcdOf('Paladin'),
    cooldowns: ['Avenging Wrath', 'Divine Protection'],
    hit: { stat: 'hitMelee', perPct: 15.77, capPct: 9, talents: [{ name: 'Precision', pctPerPoint: 1 }] },
    talentPresets: [{ name: 'Protection', talents: '-0530513050000142521051-052050003003' }],
    sim: {
      specField: 'protectionPaladin',
      specOptions: () => ({ options: { classOptions: {} } }),
      aplFile: 'paladin-protection.apl.json',
      notes: ['The rotation is the WoWSims Protection Paladin APL (Holy Shield first, Consecration, judging Seal of Righteousness).'],
      distanceFromTarget: 5,
      defaultRace: { horde: 'RaceBloodElf', alliance: 'RaceHuman' },
    },
  }),
  Druid: tankSim({
    key: 'druid-bear',
    className: 'Druid',
    specName: 'Feral Tank',
    wcl: { classId: 2, specId: 3, actorType: 'Druid' },
    gcdAbilities: gcdOf('Druid'),
    cooldowns: ['Frenzied Regeneration', 'Barkskin', 'Enrage'],
    rageFromDamageTaken: true,
    hit: { stat: 'hitMelee', perPct: 15.77, capPct: 9, talents: [] },
    talentPresets: [{ name: 'Feral Tank', talents: '-503032132322105301251-05503301' }],
    sim: {
      specField: 'feralBearDruid',
      specOptions: () => ({ options: { classOptions: {}, startingRage: 0 } }),
      aplFile: 'druid-bear.apl.json',
      notes: ['The rotation is the WoWSims Feral Bear APL (Mangle, Lacerate stacks, Maul with spare rage), with no starting rage.'],
      distanceFromTarget: 5,
      defaultRace: { horde: 'RaceTauren', alliance: 'RaceNightElf' },
    },
  }),
};
