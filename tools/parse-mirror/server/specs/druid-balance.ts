import type { SpecConfig } from './types.ts';

// Top Balance druids in Anniversary: Starfire with Moonfire, their own Faerie Fire, Force of
// Nature on cooldown and often an Innervate on themselves. WoWSims' Balance APL has switches for
// Faerie Fire, Insect Swarm and self-Innervate, set from what the player cast. Moonkin Aura only
// exists in WoWSims as a party buff, so the druid's own aura stays in the raid environment.
export const druidBalance: SpecConfig = {
  key: 'druid-balance',
  className: 'Druid',
  specName: 'Balance',
  wcl: { classId: 2, specId: 1, actorType: 'Druid' },
  caster: true,
  activityLabel: 'Time casting',
  gapThresholdSec: 0.75,

  trackedCasts: [
    { name: 'Starfire', higherIsBetter: true },
    { name: 'Moonfire', higherIsBetter: null },
    { name: 'Wrath', higherIsBetter: null },
    { name: 'Insect Swarm', higherIsBetter: null },
    { name: 'Faerie Fire', higherIsBetter: null },
    { name: 'Force of Nature', higherIsBetter: true },
    { name: 'Hurricane', higherIsBetter: null },
  ],
  efficiency: [{ name: 'Force of Nature', cooldownSec: 180 }],
  // 16% spell hit against a level 73 boss; Balance of Power adds 2% per point. Improved Faerie
  // Fire only helps physical attacks.
  hit: { stat: 'hitSpell', perPct: 12.62, capPct: 16, talents: [{ name: 'Balance of Power', pctPerPoint: 2 }] },
  gcdAbilities: ['Moonfire', 'Insect Swarm', 'Faerie Fire', 'Force of Nature', 'Innervate', 'Barkskin', 'Moonkin Form', 'Rebirth'],
  gcdSec: 1.5,
  cooldowns: ['Force of Nature', 'Innervate', 'Blood Fury', 'Berserking', 'Destruction', 'Restore Mana', 'Dark Rune', 'Demonic Rune', 'Blessing of the Silver Crescent', 'Dark Iron Pipeweed'],
  castLabels: { Destruction: 'Destruction Potion', 'Restore Mana': 'Super Mana Potion', 'Dark Iron Pipeweed': 'Dark Iron Smoking Pipe' },
  uptimes: ['Bloodlust', 'Drums of Battle', 'Power Infusion', 'Innervate', "Nature's Grace"],
  debuffUptimes: ['Moonfire', 'Insect Swarm', 'Faerie Fire'],
  expectedAbilities: [],

  talentPresets: [
    { name: 'Balance', talents: '510022312503135231351--520033' },
  ],

  sim: {
    specField: 'balanceDruid',
    specOptions: () => ({ options: { classOptions: {}, okfUptime: 0 } }),
    aplFile: 'druid-balance.apl.json',
    aplVariables: (_gear, { used, ownAuras }) => ({
      'Use Faerie Fire': { const: { val: String(used.includes('Faerie Fire')) } },
      'Use Insect Swarm': { const: { val: String(used.includes('Insect Swarm')) } },
      'Use Self Innervate': { const: { val: String(ownAuras.includes('Innervate')) } },
    }),
    onlyIfCast: [{ spellId: 33831, name: 'Force of Nature' }],
    // Your own Faerie Fire and Innervate come from your rotation in the sim.
    selfProvided: ['Faerie Fire', 'Innervate'],
    notes: [
      'Talents come from the armory when the spec there matches the log; otherwise the standard Balance build.',
      'The rotation is the WoWSims Balance APL, with Faerie Fire, Insect Swarm, Force of Nature and an Innervate on yourself only if you used them in the log.',
      "Your own Moonkin Aura counts as a party buff, as it does in WoWSims.",
    ],
    knockOn: "Nature's Grace",
    distanceFromTarget: 30,
    defaultRace: { horde: 'RaceTauren', alliance: 'RaceNightElf' },
  },
};
