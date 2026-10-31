// Tank specs: how to recognise them, their Warcraft Logs ranking ids, and their threat. Threat
// follows WoWSims tbc-new exactly (core/spell_result.go ThreatFromDamage):
//   threat = (damage × spell multiplier + flat bonus) × the player's multiplier, on hits that land.
// Values are copied from WoWSims; `src` names the file, and scripts/check-threat.ts (npm run check-threat) checks them
// against a WoWSims checkout. Like WoWSims, threat from healing and rage gains isn't counted.

export interface ThreatRule {
  /** Damage multiplier for the spell (1 when unset). */
  mult?: number;
  /** Flat threat on a hit that lands (or on the cast, for spells without damage like Sunder). */
  flat?: number;
  /** WoWSims source file the value comes from (sim/<class>/<file>). */
  src: string;
  /** The literal in that file, for scripts/check-threat.ts. */
  check: string;
}

export interface TankSpec {
  /** Warcraft Logs actor icons for the spec ("Paladin-Justicar" is a tanking paladin too). */
  icons: string[];
  className: string;
  label: string;
  wcl: { classId: number; specId: number };
  /** The stance/form/aura that marks someone as tanking, and its threat multiplier. */
  tankAura: { name: string[]; mult: number; src: string; check: string };
  /** Talent threat multiplier while tanking, at 3/3 (Defiance, Feral Instinct). */
  talent?: { name: string; mult: number; src: string; check: string };
  /** Holy spells: Righteous Fury (+60%) with Improved Righteous Fury 3/3 (×1.5) = ×1.9. */
  holyMult?: { mult: number; src: string; check: string };
  spells: Record<string, ThreatRule>;
  /** Buffs that are active mitigation (uptime and the share of boss swings they cover). */
  mitigation: string[];
  /** Debuffs a tank of this class keeps on the boss. */
  bossDebuffs: string[];
  /** Defensive cooldowns. */
  cooldowns: string[];
  /** Spells that drop or hand off threat when used on yourself. */
  threatDrops: string[];
  /** Taunts. */
  taunts: string[];
  /** Abilities on the global cooldown (1.5 s), for the opener. */
  gcd: string[];
  /** Class abilities off the global cooldown that belong in an opener (not trinkets or potions). */
  offGcd: string[];
}

export const tankSpecs: TankSpec[] = [
  {
    icons: ['Warrior-Protection'],
    className: 'Warrior',
    label: 'Protection Warrior',
    wcl: { classId: 11, specId: 3 },
    tankAura: { name: ['Defensive Stance'], mult: 1.3, src: 'warrior/stances.go', check: 'ThreatMultiplier, 1.3' },
    talent: { name: 'Defiance', mult: 1.15, src: 'warrior/talents_protection.go', check: 'spellData.Defiance.Effect(shared.A_MOD_THREAT, 127)' },
    spells: {
      'Heroic Strike': { flat: 194, src: 'warrior/heroic_strike_cleave.go', check: 'FlatThreatBonus:  194' },
      Cleave: { flat: 125, src: 'warrior/heroic_strike_cleave.go', check: 'FlatThreatBonus:  125' },
      Revenge: { flat: 200, src: 'warrior/revenge.go', check: 'spellData.Revenge, 200' },
      'Sunder Armor': { flat: 301.5, src: 'warrior/sunder_armor.go', check: 'spellData.SunderArmor, 301.5' },
      'Shield Slam': { flat: 305, src: 'warrior/talents_protection.go', check: 'FlatThreatBonus:  305' },
      Devastate: { flat: 100, src: 'warrior/talents_protection.go', check: 'FlatThreatBonus:  100' },
      'Thunder Clap': { mult: 1.75, src: 'warrior/thunder_clap.go', check: 'ThreatMultiplier: 1.75' },
      Execute: { mult: 1.25, src: 'warrior/execute.go', check: 'ThreatMultiplier: 1.25' },
      Hamstring: { flat: 167.5, src: 'warrior/hamstring.go', check: 'spellData.Hamstring, 167.5' },
      'Shield Bash': { flat: 192, src: 'warrior/shield_bash.go', check: 'spellData.ShieldBash, 192' },
      // Shouts: flat × 5 split over the targets in range (shouts.go); one boss gets all of it.
      'Demoralizing Shout': { flat: 56 * 5, src: 'warrior/demoralizing_shout.go', check: 'spellData.DemoralizingShout, 56' },
      'Battle Shout': { flat: 69 * 5, src: 'warrior/shouts.go', check: 'ThreatBonus: 69' },
    },
    mitigation: ['Shield Block'],
    bossDebuffs: ['Sunder Armor', 'Thunder Clap', 'Demoralizing Shout'],
    cooldowns: ['Shield Wall', 'Last Stand'],
    threatDrops: [],
    taunts: ['Taunt', 'Mocking Blow', 'Challenging Shout'],
    offGcd: ['Bloodrage', 'Berserker Rage', 'Shield Block'],
    gcd: ['Shield Slam', 'Revenge', 'Devastate', 'Sunder Armor', 'Thunder Clap', 'Demoralizing Shout', 'Battle Shout', 'Commanding Shout', 'Shield Bash', 'Mocking Blow', 'Execute', 'Hamstring', 'Disarm', 'Challenging Shout'],
  },
  {
    icons: ['Paladin-Protection', 'Paladin-Justicar'],
    className: 'Paladin',
    label: 'Protection Paladin',
    wcl: { classId: 6, specId: 2 },
    tankAura: { name: ['Righteous Fury'], mult: 1, src: 'paladin/righteous_fury.go', check: 'threatBonus := 0.6' },
    holyMult: { mult: 1 + 0.6 * 1.5, src: 'paladin/righteous_fury.go', check: 'Effect(shared.A_ADD_PCT_MODIFIER, shared.SPELLMOD_ALL_EFFECTS)' },
    spells: {
      'Holy Shield': { mult: 1.35, src: 'paladin/holy_shield.go', check: 'ThreatMultiplier: 1.35' },
    },
    mitigation: ['Holy Shield'],
    bossDebuffs: ['Judgement of Wisdom', 'Judgement of Light', 'Judgement of the Crusader'],
    cooldowns: ['Divine Protection', 'Avenging Wrath'],
    threatDrops: ['Divine Shield', 'Blessing of Protection', 'Divine Intervention'],
    taunts: ['Righteous Defense'],
    // Judgement is off the global cooldown in TBC.
    offGcd: ['Judgement', 'Avenging Wrath'],
    gcd: ['Holy Shield', 'Consecration', "Avenger's Shield", 'Exorcism', 'Hammer of Wrath', 'Seal of Righteousness', 'Seal of Vengeance', 'Seal of Wisdom', 'Seal of Light', 'Seal of the Crusader', 'Seal of Command', 'Holy Wrath', 'Flash of Light', 'Holy Light', 'Cleanse'],
  },
  {
    icons: ['Druid-Guardian'],
    className: 'Druid',
    label: 'Feral Tank (Bear)',
    wcl: { classId: 2, specId: 3 },
    tankAura: { name: ['Dire Bear Form', 'Bear Form'], mult: 1.3, src: 'druid/forms.go', check: 'ThreatMultiplier *= 1.3' },
    talent: { name: 'Feral Instinct', mult: 1.15, src: 'druid/talents.go', check: 'spellData.FeralInstinct.Effect' },
    spells: {
      Maul: { flat: 344, src: 'druid/maul.go', check: 'spellData.Maul, 344' },
      Lacerate: { mult: 0.5, flat: 267, src: 'druid/lacerate.go', check: 'spellData.Lacerate, 267' },
      'Mangle (Bear)': { mult: 1.5 / 1.15, src: 'druid/mangle.go', check: 'ThreatMultiplier: 1.5 / 1.15' },
      'Faerie Fire (Feral)': { flat: 132, src: 'druid/faerie_fire.go', check: 'FlatThreatBonus:  132' },
      'Demoralizing Roar': { flat: 62 * 2, src: 'druid/demoralizing_roar.go', check: 'FlatThreatBonus:  62 * 2' },
    },
    mitigation: [],
    bossDebuffs: ['Demoralizing Roar', 'Lacerate', 'Mangle (Bear)', 'Faerie Fire (Feral)'],
    cooldowns: ['Frenzied Regeneration', 'Barkskin', 'Survival Instincts'],
    threatDrops: [],
    taunts: ['Growl', 'Challenging Roar'],
    offGcd: ['Enrage', 'Frenzied Regeneration'],
    gcd: ['Mangle (Bear)', 'Lacerate', 'Swipe', 'Demoralizing Roar', 'Faerie Fire (Feral)', 'Challenging Roar', 'Bear Form', 'Dire Bear Form', 'Cat Form'],
  },
];

/** Cat Form while "tanking" is threat ×0.71 (druid/forms.go): worth flagging. */
export const CAT_FORM_MULT = 0.71;

export const TANK_ICONS = new Set(tankSpecs.flatMap((s) => s.icons));

/**
 * The tank spec for a player: by icon, or for a bare class icon ("Druid") by the tanking aura they
 * held for most of the fight (uptime 0-1 by aura name).
 */
export function tankSpecFor(icon: string, uptime: (aura: string) => number = () => 0): TankSpec | undefined {
  const byIcon = tankSpecs.find((s) => s.icons.includes(icon));
  if (byIcon || icon.includes('-')) return byIcon;
  return tankSpecs.find((s) => s.className === icon && s.tankAura.name.some((n) => uptime(n) > 0.5));
}

/** Whether a player could be a tank (bare class icons included), before looking at the fight. */
export function mayTank(icon: string) {
  return TANK_ICONS.has(icon) || ['Warrior', 'Druid', 'Paladin'].includes(icon);
}
