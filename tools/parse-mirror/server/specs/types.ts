// A spec module describes everything spec-specific: what to track in the logs,
// which talent presets to assume, and how to build the WoWSims player.
import type { PlayerFightRaw } from '../analysis/collect.ts';

export interface TalentPreset {
  name: string;
  /** Wowhead-style talent string, e.g. "3400502130201-05050005505012050115". */
  talents: string;
}

export interface SpecConfig {
  key: string;
  className: string;
  specName: string;
  /** Warcraft Logs class/spec IDs as used by the rankings API on fresh/classic. */
  wcl: { classId: number; specId: number; actorType: string };

  /** Casters: time casting (begincast -> cast) counts as active, and gaps between casts matter. */
  caster: boolean;
  /** Label for the active-time metric ("GCD usage", "Time casting"). */
  activityLabel: string;
  /** Idle stretches shorter than this aren't reported as gaps. */
  gapThresholdSec: number;

  /** Abilities whose casts per minute are compared. */
  trackedCasts: { name: string; higherIsBetter: boolean | null }[];
  /** Core rotational abilities with cooldowns: casts vs max possible casts. */
  efficiency: { name: string; cooldownSec: number; /** Damage lands this long after the cast (Curse of Doom). */ delaySec?: number }[];
  /** Instant abilities that trigger the global cooldown (cast-time spells count from begincast). */
  gcdAbilities: string[];
  /** Channelled spells and their unhasted length in seconds (one cast event, at the start). */
  channels?: Record<string, number>;
  gcdSec: number;
  /** Cooldowns whose usage timing is compared (cast names as in the log). */
  cooldowns: string[];
  /** Cooldowns used to finish the boss (e.g. Shadowburn), so their timing depends on kill length. */
  finishers?: string[];
  /** Display names for casts with unclear names, e.g. "Haste" -> "Haste Potion". */
  castLabels: Record<string, string>;
  /** Buffs whose uptime is compared (higher is better). */
  uptimes: string[];
  /** Debuffs the player applies to the boss whose uptime is compared. */
  debuffUptimes?: string[];
  /** Abilities top players should use if the fight allows it (e.g. Execute). */
  expectedAbilities: string[];
  /** Damage spell ID of an execute-range ability, used to measure the execute phase from logs. */
  executeSpellId?: number;
  /**
   * Which shamans' usual totems to assume (casts before the pull aren't logged): 'party' only ones
   * proven to be in the player's party; 'raid' any in the raid (warlocks get Totem of Wrath wherever
   * an Elemental shaman is). Default: the party's, or the raid's when the party can't be worked out.
   */
  totems?: 'party' | 'raid';
  /** Rage class: track rage gained from damage taken (standing in boss AoE is a real strategy). */
  rageFromDamageTaken?: boolean;
  /**
   * Hit chance check: the combatant info's hit rating, rating per 1%, the cap against a raid boss,
   * and talents that add hit (per point).
   */
  hit: { stat: 'hitSpell' | 'hitMelee'; perPct: number; capPct: number; talents: { name: string; pctPerPoint: number }[] };

  /** Fallback talents when the armory has nothing, picked by closest tree split. */
  talentPresets: TalentPreset[];

  sim: {
    /** Name of the spec field on the WoWSims Player proto, e.g. "dpsWarrior". */
    specField: string;
    /** Spec options for the WoWSims player, possibly based on what the log shows. */
    specOptions: (raw: PlayerFightRaw, talents: string) => unknown;
    /** File in data/wowsims with the APL rotation (may depend on what the player cast). */
    aplFile: string | ((raw: PlayerFightRaw) => string);
    /** Damage abilities the sim can't model (e.g. a summoned Infernal); left out of execution %. */
    unmodeledDamage?: string[];
    /** Spec-specific notes shown with sim results. */
    notes: string[];
    /** What crits and hits feed, for the luck panel's knock-on wording ("rage, Flurry"). */
    knockOn?: string;
    /**
     * Toggle APL priority-list groups (by group name) so the sim plays like real top players.
     * WoWSims APLs use hidden groups as on/off switches.
     */
    aplGroups?: { enable?: string[]; disable?: string[] };
    /**
     * Cooldowns the sim uses at the time the player first used them in the log (or never, if they
     * didn't), instead of the APL's own timing. Bloodlust is always timed from the log.
     */
    timedCooldowns?: { spellId: number; name: string; /** Keep the APL's own condition too (e.g. don't recast while active). */ keepCondition?: boolean }[];
    distanceFromTarget: number;
    defaultRace: { horde: string; alliance: string };
  };
}

export const castLabel = (spec: SpecConfig, name: string) => spec.castLabels[name] ?? name;

export function talentSplit(talents: string): [number, number, number] {
  const trees = talents.split('-');
  const sum = (s = '') => [...s].reduce((a, c) => a + Number(c), 0);
  return [sum(trees[0]), sum(trees[1]), sum(trees[2])];
}
