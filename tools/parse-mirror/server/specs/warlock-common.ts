// What every warlock spec reads from the log for the sim: the curse they kept up and their demon.
import type { PlayerFightRaw } from '../analysis/collect.ts';

/** The curse the player kept up, as WoWSims' CurseOptions (Agony when none of the others). */
export function curseOf(raw: PlayerFightRaw): 'Elements' | 'Recklessness' | 'Doom' | 'Agony' {
  const casts = new Map(raw.fight.casts.map((c) => [c.name, c.casts]));
  if (casts.get('Curse of the Elements')) return 'Elements';
  if (casts.get('Curse of Recklessness')) return 'Recklessness';
  if (casts.get('Curse of Doom')) return 'Doom';
  return 'Agony';
}

const DEMONS = ['Felguard', 'Felhunter', 'Succubus', 'Imp', 'Voidwalker'] as const;
export type Demon = (typeof DEMONS)[number];

/**
 * The demon the player had out (WoWSims' Summon option): from the summon behind its damage, or the
 * pet icons in the fight list for a demon that did no damage. A trinket's Pumpkin Soldier has the
 * Voidwalker icon, so Voidwalker comes last.
 */
export function demonOf(raw: PlayerFightRaw): Demon | undefined {
  const summons = (raw.fight.pets ?? []).filter((p) => p.kind === 'pet').map((p) => p.summon ?? '');
  return (
    DEMONS.find((d) => summons.includes(`Summon ${d}`)) ??
    DEMONS.find((d) => raw.petIcons.some((icon) => icon.toLowerCase().includes(`summon${d.toLowerCase()}`)))
  );
}
