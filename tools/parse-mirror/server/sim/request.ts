// Builds a WoWSims RaidSimRequest (protojson) for one player.
import type { ConsumeUse } from '../../shared/types.ts';
import { SIM_SLOT_ORDER, type PlayerFightRaw } from '../analysis/collect.ts';
import type { DetectedConsumes } from '../data/consumes.ts';
import { itemInfo, loadJson, simItemId } from '../data/db.ts';
import { baseEncounterId, game } from '../game.ts';
import { talentSplit, type SpecConfig } from '../specs/types.ts';
import type { WclGear } from '../wcl/types.ts';
import { buildEnvironment, type SimEnvironment } from './environment.ts';

// Index of each stat in the WoWSims stats array (proto Stat enum).
const STAT_ATTACK_POWER = 17;
const STAT_ARMOR = 31;
const NUM_STATS = 42;

// Boss base armor (before debuffs); see server/game.ts.
export const bossArmor = (encounterId: number) => game.boss.armor[baseEncounterId(encounterId)] ?? game.boss.defaultArmor;

export interface SimPlayerSetup {
  name: string;
  race: string;
  gear: (WclGear | undefined)[];
  consumes: ConsumeUse[];
  flags: DetectedConsumes['flags'];
  conjuredId?: number;
  talents: string;
  specOptions: unknown;
  aplFile: string;
  /** When Bloodlust and timed cooldowns happened in the log, in seconds (undefined = not used). */
  timing: { bloodlustSec?: number; cooldowns: { spellId: number; atSec?: number; keepCondition?: boolean }[] };
  /** Rotation spells the player never cast, which the sim skips too (spec.sim.onlyIfCast). */
  skipSpells?: number[];
  /** What the player did, for spec.sim.aplVariables: cast names and pet summons, and their own auras. */
  used?: { used: string[]; ownAuras: string[] };
}

/**
 * A player's buffs and boss debuffs for the sim environment, without the ones they provided
 * themselves that the sim's class code gives them anyway (spec.sim.selfProvided).
 */
export function raidAurasOf(raw: PlayerFightRaw, spec: SpecConfig) {
  const own = new Set([...(spec.sim.selfProvided ?? []).filter((name) => raw.ownAuras.includes(name)), ...(spec.sim.excludeBuffs ?? [])]);
  return {
    buffs: own.size ? raw.fight.buffs.filter((b) => !own.has(b.name)) : raw.fight.buffs,
    bossDebuffs: own.size ? raw.fight.bossDebuffs.filter((d) => !own.has(d.name)) : raw.fight.bossDebuffs,
  };
}

/** The sim environment (raid buffs, boss debuffs) a player had in their fight. */
export function environmentOf(raw: PlayerFightRaw, spec: SpecConfig) {
  const { buffs, bossDebuffs } = raidAurasOf(raw, spec);
  return buildEnvironment(buffs, bossDebuffs, raw.consumes.drums, {
    isbHitPct: raw.fight.isbHitPct,
    shadowPriestDps: raw.fight.partyShadowPriestDps,
  });
}

export const encounterOf = (raw: PlayerFightRaw) => ({
  id: raw.encounterId,
  name: raw.encounterName,
  executeProportion: raw.executeProportion,
});

export function setupFromRaw(raw: PlayerFightRaw, spec: SpecConfig): SimPlayerSetup {
  return {
    name: raw.fight.name,
    race: raw.raceProto,
    gear: raw.combatant?.gear ?? [],
    consumes: raw.consumes.list,
    flags: raw.consumes.flags,
    conjuredId: raw.consumes.conjuredId,
    talents: raw.fight.talents,
    specOptions: spec.sim.specOptions(raw, raw.fight.talents),
    aplFile: typeof spec.sim.aplFile === 'string' ? spec.sim.aplFile : spec.sim.aplFile(raw),
    skipSpells: (spec.sim.onlyIfCast ?? []).filter((s) => !raw.fight.casts.some((c) => c.name === s.name)).map((s) => s.spellId),
    used: {
      used: [...raw.fight.casts.map((c) => c.name), ...(raw.fight.pets ?? []).map((p) => p.summon ?? p.name)],
      ownAuras: raw.ownAuras,
    },
    timing: {
      bloodlustSec: raw.fight.buffs.find((b) => b.name === 'Bloodlust' || b.name === 'Heroism')?.starts?.[0],
      cooldowns: (spec.sim.timedCooldowns ?? []).map((c) => ({
        spellId: c.spellId,
        atSec: raw.fight.cooldowns.find((u) => u.name === c.name)?.times[0] ?? (c.pet && raw.fight.pets?.some((p) => p.summon === c.pet) ? 0 : undefined),
        keepCondition: c.keepCondition,
      })),
    },
  };
}

/** Gear item IDs the sim leaves out because WoWSims doesn't have them. */
export const unknownItems = (gear: (WclGear | undefined)[]) => SIM_SLOT_ORDER.map((i) => gear[i]?.id).filter((id): id is number => !!id && !itemInfo(id));

/** Logs only have points per tree, so pick the preset with the closest split. */
export function closestTalentPreset(spec: SpecConfig, split: [number, number, number]): string {
  let best = spec.talentPresets[0];
  let bestDistance = Infinity;
  for (const preset of spec.talentPresets) {
    const s = talentSplit(preset.talents);
    const distance = s.reduce((acc, v, i) => acc + Math.abs(v - split[i]), 0);
    if (distance < bestDistance) {
      best = preset;
      bestDistance = distance;
    }
  }
  return best.talents;
}

function consumablesSpec(player: SimPlayerSetup) {
  const first = (category: ConsumeUse['category']) => player.consumes.find((c) => c.category === category && c.simId)?.simId;
  const { flags } = player;
  // Potions share a cooldown and a kill rarely allows two, so the sim gets the DPS potion (Haste,
  // Destruction...) over a mana potion when the player used both.
  const potions = player.consumes.filter((c) => c.category === 'Potion' && c.simId);
  const potId = (potions.find((c) => !/Mana/.test(c.name)) ?? potions[0])?.simId;
  return {
    flaskId: first('Flask'),
    battleElixirId: first('Battle Elixir'),
    guardianElixirId: first('Guardian Elixir'),
    foodId: first('Food'),
    potId,
    explosiveId: first('Engineering'),
    conjuredId: player.conjuredId,
    // The sim only registers potions/conjured items listed here (the WoWSims UI fills these in).
    potions: potId ? [potId] : [],
    conjuredItems: player.conjuredId ? [player.conjuredId] : [],
    mhImbueId: first('Weapon (MH)'),
    ohImbueId: first('Weapon (OH)'),
    superSapper: flags.superSapper,
    goblinSapper: flags.goblinSapper,
    scrollAgi: flags.scrollAgi,
    scrollStr: flags.scrollStr,
    petScrollAgi: flags.petScrollAgi,
    petScrollStr: flags.petScrollStr,
    nightmareSeed: flags.nightmareSeed,
    boglingRoot: flags.boglingRoot,
  };
}

const usesEngineering = (player: SimPlayerSetup) =>
  !!(player.flags.superSapper || player.flags.goblinSapper || player.consumes.some((c) => c.category === 'Engineering' && c.simId));

interface AplPrepull {
  action: { castSpell?: { spellId: { spellId?: number } } };
}

interface AplItem {
  hide?: boolean;
  action: { condition?: unknown; groupReference?: { groupName: string }; castSpell?: { spellId: { spellId?: number; tag?: number } } };
}

const BLOODLUST = { spellId: 2825, tag: -1 };

/** Whether an APL action (or anything nested in it: a sequence, a group's actions) casts this spell. */
function castsSpell(node: unknown, spellId: number): boolean {
  if (Array.isArray(node)) return node.some((n) => castsSpell(n, spellId));
  if (!node || typeof node !== 'object') return false;
  const cast = (node as { castSpell?: { spellId?: { spellId?: number } } }).castSpell;
  if (cast?.spellId?.spellId === spellId) return true;
  // Conditions only test the spell (spellIsReady...); they don't cast it.
  return Object.entries(node).some(([k, v]) => k !== 'condition' && castsSpell(v, spellId));
}
const atOrAfter = (sec: number) => ({ cmp: { op: 'OpGe', lhs: { currentTime: {} }, rhs: { const: { val: `${sec.toFixed(1)}s` } } } });

function loadRotation(spec: SpecConfig, player: SimPlayerSetup) {
  const { aplFile, timing, skipSpells = [], gear } = player;
  const apl = structuredClone(
    loadJson<{ priorityList: AplItem[]; prepullActions?: AplPrepull[]; valueVariables?: { name: string; value: unknown }[]; groups?: { name: string; actions: unknown[] }[] }>(aplFile),
  );
  for (const [name, value] of Object.entries(spec.sim.aplVariables?.(gear, player.used ?? { used: [], ownAuras: [] }) ?? {})) {
    const variable = apl.valueVariables?.find((v) => v.name === name);
    if (variable) variable.value = value;
  }
  const { enable = [], disable = [] } = spec.sim.aplGroups ?? {};
  for (const item of apl.priorityList) {
    const group = item.action.groupReference?.groupName;
    if (group && enable.includes(group)) item.hide = false;
    if (group && disable.includes(group)) item.hide = true;
    const spellId = item.action.castSpell?.spellId.spellId;
    if (spellId !== undefined && skipSpells.includes(spellId)) item.hide = true;
  }

  // Use cooldowns when the player did. Without an APL action for it, WoWSims would use it on pull.
  const timed: { spellId: { spellId: number; tag?: number }; atSec?: number; keepCondition?: boolean }[] = timing.cooldowns.map((c) => ({
    spellId: { spellId: c.spellId },
    atSec: c.atSec,
    keepCondition: c.keepCondition,
  }));
  const lustVar = apl.valueVariables?.find((v) => v.name === 'Bloodlust time');
  if (timing.bloodlustSec !== undefined) {
    // Fury/Arms APLs line Death Wish, potions etc. up with this variable too.
    if (lustVar) lustVar.value = atOrAfter(timing.bloodlustSec).cmp.rhs;
    else timed.push({ spellId: BLOODLUST, atSec: timing.bloodlustSec });
  }
  // A shaman's own Bloodlust is a cooldown of their own (tagged with their raid index, 0 here) that
  // the sim would otherwise use on pull; it goes when the log's did (whichever goes first, the
  // other finds everyone Sated), or never.
  if (spec.className === 'Shaman') timed.push({ spellId: { spellId: BLOODLUST.spellId, tag: 0 }, atSec: timing.bloodlustSec });
  for (const t of timed) {
    // A cooldown the APL uses before the pull (a rogue's Adrenaline Rush) goes when the log's did instead.
    if (apl.prepullActions) apl.prepullActions = apl.prepullActions.filter((p) => p.action.castSpell?.spellId.spellId !== t.spellId.spellId);
    const condition = t.atSec === undefined ? { const: { val: 'false' } } : atOrAfter(t.atSec);
    // A tagged spell (one of the two Bloodlusts) only matches the same tag.
    const actions = apl.priorityList.filter(
      (i) => !i.hide && i.action.castSpell?.spellId.spellId === t.spellId.spellId && (t.spellId.tag === undefined || i.action.castSpell.spellId.tag === t.spellId.tag),
    );
    for (const item of actions) {
      const own = item.action.condition;
      item.action.condition = t.keepCondition && own && t.atSec !== undefined ? { and: { vals: [condition, own] } } : condition;
    }
    // Some APLs cast it from a group (Enhancement's Fire Elemental, inside a totem-twist sequence):
    // the group's reference gets the timing on top of its own condition.
    const groupRefs =
      t.spellId.tag === undefined
        ? apl.priorityList.filter((i) => {
            const group = apl.groups?.find((g) => g.name === i.action.groupReference?.groupName);
            return !i.hide && !!group && castsSpell(group.actions, t.spellId.spellId);
          })
        : [];
    for (const item of groupRefs) {
      const own = item.action.condition;
      item.action.condition = own ? { and: { vals: [condition, own] } } : condition;
    }
    if (!actions.length && !groupRefs.length) apl.priorityList.unshift({ action: { condition, castSpell: { spellId: t.spellId } } });
  }
  return apl;
}

/** The boss's melee: seconds between swings per weapon (before slows) and WoWSims' minimum base damage. */
export interface BossMelee {
  swingSpeed: number;
  dualWield: boolean;
  minBaseDamage: number;
}

export function buildRequest(opts: {
  spec: SpecConfig;
  player: SimPlayerSetup;
  env: SimEnvironment;
  durationSec: number;
  encounter: { id: number; name: string; executeProportion?: number };
  iterations: number;
  /** Tank sims: the player tanks the boss, which swings like it did in the log (see sim/tank.ts). */
  tank?: BossMelee;
}) {
  const { spec, player, env, encounter } = opts;
  const execute20 = encounter.executeProportion ?? 0.2;

  const items = SIM_SLOT_ORDER.map((i) => {
    const g = player.gear[i];
    // Items WoWSims doesn't have (newer Anniversary items) would fail the whole sim; leave them out.
    if (!g || !g.id || !itemInfo(g.id)) return {};
    return {
      id: simItemId(g.id),
      ...(g.permanentEnchant ? { enchant: g.permanentEnchant } : {}),
      ...(g.gems?.length ? { gems: g.gems.map((gem) => gem.id) } : {}),
    };
  });

  const stats = new Array(NUM_STATS).fill(0);
  stats[STAT_ARMOR] = bossArmor(encounter.id);
  stats[STAT_ATTACK_POWER] = 320;

  // Buffs WoWSims has no option for (e.g. Hyjal's Rallying Cry), averaged over the fight.
  const bonusStats = new Array(NUM_STATS).fill(0);
  for (const [idx, value] of Object.entries(env.bonusStats)) bonusStats[Number(idx)] += value;

  return {
    raid: {
      parties: [
        {
          players: [
            {
              name: player.name,
              race: player.race,
              class: `Class${spec.className}`,
              equipment: { items },
              consumables: consumablesSpec(player),
              bonusStats: { stats: bonusStats },
              buffs: env.individualBuffs,
              talentsString: player.talents,
              // Sappers and grenades only work with Engineering; logs don't show professions.
              profession1: usesEngineering(player) ? 'Engineering' : undefined,
              rotation: loadRotation(spec, player),
              [spec.sim.specField]: player.specOptions,
              distanceFromTarget: spec.sim.distanceFromTarget,
              // The WoWSims site's default. Left out, WoWSims uses 10 ms: a rogue pooling energy or a
              // hunter waiting on Auto Shot re-runs the whole rotation every 10 ms, 5x slower.
              reactionTimeMs: 100,
              ...(opts.tank ? { inFrontOfTarget: true } : {}),
            },
          ],
          buffs: env.partyBuffs,
        },
      ],
      buffs: env.raidBuffs,
      debuffs: env.debuffs,
      ...(opts.tank ? { tanks: [{ type: 'Player', index: 0 }] } : {}),
    },
    encounter: {
      duration: opts.durationSec,
      durationVariation: 0,
      // The sim steps through 90% -> 45% -> 35% -> 25% -> 20% health; every step must be set or
      // it never reaches the execute phase. The 20% step comes from the log when we have it,
      // the rest are WoWSims UI defaults (linear health), kept in order.
      executeProportion20: execute20,
      executeProportion25: Math.max(0.25, execute20),
      executeProportion35: Math.max(0.35, execute20),
      executeProportion45: Math.max(0.45, execute20),
      executeProportion90: 0.9,
      targets: [
        {
          name: encounter.name,
          level: game.boss.level,
          mobType: game.boss.mobType[baseEncounterId(encounter.id)] ?? 'MobTypeUnknown',
          stats,
          swingSpeed: opts.tank?.swingSpeed ?? 2,
          minBaseDamage: opts.tank?.minBaseDamage ?? 15113,
          ...(opts.tank?.dualWield ? { dualWield: true } : {}),
          // Tank sims: the boss starts on the player (index 0 in raid.tanks); otherwise untanked.
          ...(opts.tank ? { tankIndex: 0 } : {}),
          parryHaste: true,
          canCrush: true,
          damageSpread: 0.5,
        },
      ],
    },
    simOptions: { iterations: opts.iterations, randomSeed: 1 },
  };
}
