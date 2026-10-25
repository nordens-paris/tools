// Product name in one place, so renaming the tool is a one-line change.
export const APP_NAME = 'Parse Mirror';
export const GUILD_NAME = 'Nordens Paris';

export const specIcon = (className: string, specName: string) => `/icons/${className.toLowerCase()}-${specName.toLowerCase()}.jpg`;

export const SUPPORTED = [
  { className: 'Warrior', specName: 'Fury' },
  { className: 'Warlock', specName: 'Destruction' },
  { className: 'Mage', specName: 'Arcane' },
  { className: 'Priest', specName: 'Shadow' },
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
    label: 'Darkfadè · whole raid',
    url: 'https://fresh.warcraftlogs.com/reports/q1Jr4LdHVzycnGA9?source=19',
    icon: specIcon('Warlock', 'Destruction'),
  },
];
