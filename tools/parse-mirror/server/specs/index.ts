import { druidBalance } from './druid-balance.ts';
import { druidFeral } from './druid-feral.ts';
import { hunterBeastMastery, hunterMarksmanship, hunterSurvival } from './hunter.ts';
import { paladinRetribution } from './paladin-retribution.ts';
import { rogueCombat } from './rogue-combat.ts';
import { shamanElemental } from './shaman-elemental.ts';
import { shamanEnhancement } from './shaman-enhancement.ts';
import { specNameFor } from './trees.ts';
import type { SpecConfig } from './types.ts';
import { mageArcane } from './mage-arcane.ts';
import { priestShadow } from './priest-shadow.ts';
import { warlockAffliction } from './warlock-affliction.ts';
import { warlockDestruction } from './warlock-destruction.ts';
import { warriorArms } from './warrior-arms.ts';
import { warriorFury } from './warrior-fury.ts';

export { specNameFor };

export const specs: SpecConfig[] = [warriorFury, warriorArms, warlockDestruction, warlockAffliction, mageArcane, priestShadow, shamanElemental, druidBalance, paladinRetribution, shamanEnhancement, rogueCombat, druidFeral, hunterBeastMastery, hunterMarksmanship, hunterSurvival];

/**
 * Finds the spec module for a Warcraft Logs actor icon like "Warrior-Fury". Logs often only have
 * the class ("Shaman"); with the player's talent points per tree, the tree with the most decides.
 * Tanks and healers have no module here, so a bare icon may still be one of those (check first).
 */
export function specForIcon(icon: string, talentSplit?: [number, number, number]): SpecConfig | undefined {
  const cls = icon.split('-')[0];
  const spec = specNameFor(icon, talentSplit);
  return specs.find((s) => s.className === cls && s.specName === spec);
}

/** Whether a bare class icon ("Rogue") may be a supported DPS spec, before looking at the talents. */
export const mayBeDps = (icon: string) => !icon.includes('-') && specs.some((s) => s.className === icon);

export const supportedSpecs = specs.map((s) => `${s.specName.replace(/([a-z])([A-Z])/g, '$1 $2')} ${s.className}`);
