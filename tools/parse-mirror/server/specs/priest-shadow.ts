import type { SpecConfig } from './types.ts';

export const priestShadow: SpecConfig = {
  key: 'priest-shadow',
  className: 'Priest',
  specName: 'Shadow',
  wcl: { classId: 7, specId: 3, actorType: 'Priest' },
  caster: true,
  // Shadow priests share a party with arcane mages, rarely with an Elemental shaman.
  totems: 'party',
  activityLabel: 'Time casting',
  gapThresholdSec: 0.75,

  trackedCasts: [
    { name: 'Mind Flay', higherIsBetter: null },
    { name: 'Mind Blast', higherIsBetter: true },
    { name: 'Shadow Word: Death', higherIsBetter: null },
    { name: 'Vampiric Touch', higherIsBetter: null },
    { name: 'Shadow Word: Pain', higherIsBetter: null },
    { name: 'Devouring Plague', higherIsBetter: null },
    { name: 'Starshards', higherIsBetter: null },
  ],
  // Improved Mind Blast (5/5) brings Mind Blast down to 5.5 s.
  efficiency: [
    { name: 'Mind Blast', cooldownSec: 5.5 },
    { name: 'Shadow Word: Death', cooldownSec: 12 },
  ],
  // 16% spell hit against a level 73 boss; Shadow Focus adds 2% per point to Shadow spells.
  hit: { stat: 'hitSpell', perPct: 12.62, capPct: 16, talents: [{ name: 'Shadow Focus', pctPerPoint: 2 }] },
  gcdAbilities: [
    'Shadow Word: Pain',
    'Shadow Word: Death',
    'Vampiric Embrace',
    'Shadowfiend',
    'Devouring Plague',
    'Starshards',
    'Inner Fire',
    'Power Word: Shield',
    'Shadowguard',
    'Fear Ward',
    'Psychic Scream',
    'Fade',
  ],
  channels: { 'Mind Flay': 3 },
  gcdSec: 1.5,
  cooldowns: ['Shadowfiend', 'Inner Focus', 'Power Infusion', 'Berserking', 'Arcane Torrent', 'Destruction', 'Restore Mana', 'Dark Rune', 'Demonic Rune', 'Blessing of the Silver Crescent'],
  castLabels: { Destruction: 'Destruction Potion', 'Restore Mana': 'Super Mana Potion' },
  uptimes: ['Bloodlust', 'Drums of Battle', 'Power Infusion'],
  debuffUptimes: ['Vampiric Touch', 'Shadow Word: Pain', 'Devouring Plague'],
  expectedAbilities: [],

  // WoWSims preset, used when the armory has no matching spec.
  talentPresets: [{ name: 'Shadow', talents: '500230013--503250510240103051451' }],

  sim: {
    specField: 'dpsPriest',
    // Shadowform and Inner Fire aren't in Anniversary logs, so both are assumed.
    specOptions: (raw) => ({
      options: {
        classOptions: {
          armor: 'InnerFire',
          useShadowfiend: raw.fight.casts.some((c) => c.name === 'Shadowfiend'),
          preShadowform: true,
        },
      },
    }),
    aplFile: 'priest-shadow.apl.json',
    // Troll priests' Shadowguard isn't in the sim.
    unmodeledDamage: ['Shadowguard'],
    notes: [
      'Talents come from the armory when the spec there matches the log; otherwise the WoWSims Shadow build.',
      "Shadowform and Inner Fire are assumed (self-buffs aren't in Anniversary logs). Shadowfiend is used if the player cast it.",
      "Shadowguard (Troll racial) isn't in the sim; its damage is left out of real DPS for the execution score.",
    ],
    knockOn: 'Vampiric Touch mana',
    distanceFromTarget: 20,
    defaultRace: { horde: 'RaceUndead', alliance: 'RaceDwarf' },
  },
};
