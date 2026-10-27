// Healer specs. Healers aren't simmed, so this is only what the healer analysis needs: how to
// recognise the spec, its Warcraft Logs ranking ids, and the spells it keeps up on others.

export interface HealerSpec {
  /** Warcraft Logs actor icon, e.g. "Priest-Holy". */
  icon: string;
  className: string;
  label: string;
  wcl: { classId: number; specId: number };
  /** Heals only this spec of the class casts: tells a bare "Priest" icon's spec apart. */
  signature: string[];
  /** Buffs/HoTs kept on other players, measured as upkeep. */
  upkeep: string[];
}

export const healerSpecs: HealerSpec[] = [
  {
    icon: 'Priest-Holy',
    className: 'Priest',
    label: 'Holy Priest',
    wcl: { classId: 7, specId: 2 },
    signature: ['Circle of Healing', 'Spirit of Redemption'],
    upkeep: ['Renew', 'Prayer of Mending'],
  },
  {
    icon: 'Priest-Discipline',
    className: 'Priest',
    label: 'Discipline Priest',
    wcl: { classId: 7, specId: 1 },
    signature: ['Pain Suppression'],
    upkeep: ['Power Word: Shield', 'Renew', 'Prayer of Mending'],
  },
  {
    icon: 'Paladin-Holy',
    className: 'Paladin',
    label: 'Holy Paladin',
    wcl: { classId: 6, specId: 1 },
    signature: ['Holy Shock', 'Holy Light', 'Flash of Light'],
    upkeep: [],
  },
  {
    icon: 'Shaman-Restoration',
    className: 'Shaman',
    label: 'Restoration Shaman',
    wcl: { classId: 9, specId: 3 },
    signature: ['Earth Shield', 'Chain Heal'],
    upkeep: ['Earth Shield'],
  },
  {
    icon: 'Druid-Restoration',
    className: 'Druid',
    label: 'Restoration Druid',
    wcl: { classId: 2, specId: 4 },
    signature: ['Lifebloom', 'Swiftmend'],
    upkeep: ['Lifebloom', 'Rejuvenation', 'Regrowth'],
  },
];

/** Icons of specs that never heal for real, so a big share of healing doesn't make them healers. */
const NOT_HEALER = /-(Shadow|Retribution|Protection|Elemental|Enhancement|Balance|Feral|Guardian)$/;

/**
 * The healer spec for an actor: by icon, or for a bare class icon ("Priest") by the heals they cast.
 * Table icons (healing done, damage taken) carry the spec more often than the fight list's.
 * "Druid-Dreamstate" is Warcraft Logs' Balance/Resto hybrid; healing with Resto spells, it's a Resto Druid.
 */
export function healerSpecFor(icon: string, healsCast: Iterable<string> = []): HealerSpec | undefined {
  const byIcon = healerSpecs.find((s) => s.icon === icon);
  if (byIcon || NOT_HEALER.test(icon)) return byIcon;
  const [cls, specName] = icon.split('-');
  if (specName && specName !== 'Dreamstate') return undefined;
  const cast = new Set(healsCast);
  return healerSpecs.find((s) => s.className === cls && s.signature.some((n) => cast.has(n)));
}

/** Whether a player could be a healer (bare class icons included), before looking at their heals. */
export function mayHeal(icon: string) {
  return !!healerSpecFor(icon) || ['Priest', 'Paladin', 'Shaman', 'Druid', 'Druid-Dreamstate'].includes(icon);
}

/** Self- and party cooldowns that matter for a healer's mana or throughput. */
export const HEALER_COOLDOWNS: Record<string, string> = {
  'Restore Mana': 'Mana potion',
  'Dark Rune': 'Dark Rune',
  'Demonic Rune': 'Demonic Rune',
  Shadowfiend: 'Shadowfiend',
  'Mana Tide Totem': 'Mana Tide',
  'Divine Illumination': 'Divine Illumination',
  Innervate: 'Innervate',
  'Inner Focus': 'Inner Focus',
  'Divine Favor': 'Divine Favor',
  "Nature's Swiftness": "Nature's Swiftness",
  'Power Infusion': 'Power Infusion',
  'Arcane Torrent': 'Arcane Torrent',
  'Symbol of Hope': 'Symbol of Hope',
  'Pain Suppression': 'Pain Suppression',
};

/** Heals that fire by themselves when damage lands: not a decision, so not a reaction or a save. */
export const AUTO_HEALS = new Set(['Prayer of Mending', 'Earth Shield', 'Lifebloom']);

export const DISPELS = new Set([
  'Cleanse',
  'Purify',
  'Dispel Magic',
  'Abolish Poison',
  'Cure Poison',
  'Abolish Disease',
  'Cure Disease',
  'Remove Curse',
  'Cleansing Totem',
  'Poison Cleansing Totem',
  'Disease Cleansing Totem',
  'Mass Dispel',
]);

/** HoTs whose direct part (if any) isn't the point; used to find the target of the last direct heal. */
export const HOTS = new Set(['Renew', 'Rejuvenation', 'Lifebloom', 'Regrowth']);

export const TANK_ICON = /^(Warrior-Protection|Paladin-Protection|Druid-Guardian)$/;
