// Talent trees, apart from the spec modules: the healer analysis runs in the browser too.
// Each class's talent trees in order, named as in Warcraft Logs icons ("Hunter-BeastMastery").
const TREES: Record<string, [string, string, string]> = {
  Druid: ['Balance', 'Feral', 'Restoration'],
  Hunter: ['BeastMastery', 'Marksmanship', 'Survival'],
  Mage: ['Arcane', 'Fire', 'Frost'],
  Paladin: ['Holy', 'Protection', 'Retribution'],
  Priest: ['Discipline', 'Holy', 'Shadow'],
  Rogue: ['Assassination', 'Combat', 'Subtlety'],
  Shaman: ['Elemental', 'Enhancement', 'Restoration'],
  Warlock: ['Affliction', 'Demonology', 'Destruction'],
  Warrior: ['Arms', 'Fury', 'Protection'],
};

/** The spec name from the icon, or for a bare class icon the talent tree with the most points. */
export function specNameFor(icon: string, talentSplit?: [number, number, number]): string | undefined {
  const [cls, iconSpec] = icon.split('-');
  if (iconSpec || !talentSplit || !TREES[cls] || Math.max(...talentSplit) <= 0) return iconSpec;
  return TREES[cls][talentSplit.indexOf(Math.max(...talentSplit))];
}
