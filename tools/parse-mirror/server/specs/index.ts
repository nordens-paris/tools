import type { SpecConfig } from './types.ts';
import { mageArcane } from './mage-arcane.ts';
import { priestShadow } from './priest-shadow.ts';
import { warlockDestruction } from './warlock-destruction.ts';
import { warriorFury } from './warrior-fury.ts';

export const specs: SpecConfig[] = [warriorFury, warlockDestruction, mageArcane, priestShadow];

/** Finds the spec module for a Warcraft Logs actor icon like "Warrior-Fury". */
export function specForIcon(icon: string): SpecConfig | undefined {
  const [cls, spec] = icon.split('-');
  return specs.find((s) => s.className === cls && s.specName === spec);
}

export const supportedSpecs = specs.map((s) => `${s.specName} ${s.className}`);
