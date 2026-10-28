// Product name in one place, so renaming the tool is a one-line change.
export const APP_NAME = 'Parse Mirror';
export const GUILD_NAME = 'Nordens Paris';

export const specIcon = (className: string, specName: string) => `/icons/${className.toLowerCase()}-${specName.toLowerCase()}.jpg`;

export const SUPPORTED = [
  { className: 'Warrior', specName: 'Fury' },
  { className: 'Warrior', specName: 'Arms' },
  { className: 'Warlock', specName: 'Destruction' },
  { className: 'Warlock', specName: 'Affliction' },
  { className: 'Mage', specName: 'Arcane' },
  { className: 'Priest', specName: 'Shadow' },
  { className: 'Shaman', specName: 'Elemental' },
  { className: 'Druid', specName: 'Balance' },
  { className: 'Paladin', specName: 'Retribution' },
  { className: 'Shaman', specName: 'Enhancement' },
  { className: 'Rogue', specName: 'Combat' },
  { className: 'Druid', specName: 'Feral' },
  { className: 'Hunter', specName: 'BeastMastery' },
  { className: 'Hunter', specName: 'Marksmanship' },
  { className: 'Hunter', specName: 'Survival' },
];

/** Tank specs: compared with tanks from well-run raids, no sims yet. */
export const TANKS = [
  { className: 'Warrior', specName: 'Protection' },
  { className: 'Paladin', specName: 'Protection' },
  { className: 'Druid', specName: 'Guardian' },
];

/** Healer specs: compared with healers from well-run raids, no sims. */
export const HEALERS = [
  { className: 'Priest', specName: 'Holy' },
  { className: 'Priest', specName: 'Discipline' },
  { className: 'Paladin', specName: 'Holy' },
  { className: 'Shaman', specName: 'Restoration' },
  { className: 'Druid', specName: 'Restoration' },
];

export const EXAMPLES = [
  {
    label: 'Nuttý · Fury · Rage Winterchill',
    url: 'https://fresh.warcraftlogs.com/reports/dqF8J9TbnCHQ4jgk?fight=10&type=damage-done&source=6',
    icon: specIcon('Warrior', 'Fury'),
  },
  {
    label: 'Darkfadè · Destruction · Kaz’rogal',
    url: 'https://fresh.warcraftlogs.com/reports/q1Jr4LdHVzycnGA9?fight=40&type=damage-done&source=19',
    icon: specIcon('Warlock', 'Destruction'),
  },
  {
    label: 'Levmetté · Arcane · Rage Winterchill',
    url: 'https://fresh.warcraftlogs.com/reports/nbfHKZ2Ax6JghkjD?fight=79&type=damage-done&source=28',
    icon: specIcon('Mage', 'Arcane'),
  },
  {
    label: 'Moonianlie · Shadow · Rage Winterchill',
    url: 'https://fresh.warcraftlogs.com/reports/nbfHKZ2Ax6JghkjD?fight=79&type=damage-done&source=5',
    icon: specIcon('Priest', 'Shadow'),
  },
  {
    label: 'Laalaaqq · Combat · Kaz’rogal',
    url: 'https://fresh.warcraftlogs.com/reports/nbfHKZ2Ax6JghkjD?fight=101&type=damage-done&source=15',
    icon: specIcon('Rogue', 'Combat'),
  },
  {
    label: 'Miracleprime · Beast Mastery · Kaz’rogal',
    url: 'https://fresh.warcraftlogs.com/reports/nbfHKZ2Ax6JghkjD?fight=101&type=damage-done&source=9',
    icon: specIcon('Hunter', 'BeastMastery'),
  },
  {
    label: 'Ghorzach · Elemental · Kaz’rogal',
    url: 'https://fresh.warcraftlogs.com/reports/nbfHKZ2Ax6JghkjD?fight=101&type=damage-done&source=8',
    icon: specIcon('Shaman', 'Elemental'),
  },
  {
    label: 'Sanctalux · Holy Paladin · Bloodboil',
    url: 'https://fresh.warcraftlogs.com/reports/nbfHKZ2Ax6JghkjD?fight=64&type=healing&source=13',
    icon: specIcon('Paladin', 'Holy'),
  },
  {
    label: 'Storbøf · Bear tank · Naj’entus',
    url: 'https://fresh.warcraftlogs.com/reports/nbfHKZ2Ax6JghkjD?fight=14&type=damage-taken&source=4',
    icon: specIcon('Druid', 'Guardian'),
  },
  {
    label: 'Darkfadè · whole raid',
    url: 'https://fresh.warcraftlogs.com/reports/q1Jr4LdHVzycnGA9?source=19',
    icon: specIcon('Warlock', 'Destruction'),
  },
];
