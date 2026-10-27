// Gathers everything we need about one player in one fight from Warcraft Logs.
import type { AbilityCasts, AuraUptime, CooldownUse, GearItem, PlayerFight } from '../../shared/types.ts';
import { detectConsumes, tempEnchantName, type DetectedConsumes } from '../data/consumes.ts';
import { armoryTalents } from '../armory/talents.ts';
import { enchantInfo, gemInfo, itemInfo, spellName } from '../data/db.ts';
import { talentRank } from '../data/talents.ts';
import { closestTalentPreset } from '../sim/request.ts';
import { castLabel, type SpecConfig } from '../specs/types.ts';
import type { WclClient } from '../wcl/client.ts';
import type { WclAura, WclCombatantInfo, WclEvent, WclFight, WclFightsResponse, WclTableEntry } from '../wcl/types.ts';

// Warcraft Logs gear array index -> slot name. Shirt (3) and tabard (18) are skipped.
export const WCL_SLOTS: Record<number, string> = {
  0: 'Head',
  1: 'Neck',
  2: 'Shoulder',
  14: 'Back',
  4: 'Chest',
  8: 'Wrist',
  9: 'Hands',
  5: 'Waist',
  6: 'Legs',
  7: 'Feet',
  10: 'Finger 1',
  11: 'Finger 2',
  12: 'Trinket 1',
  13: 'Trinket 2',
  15: 'Main Hand',
  16: 'Off Hand',
  17: 'Ranged',
};
/** WoWSims equipment order, as WCL gear indexes. */
export const SIM_SLOT_ORDER = [0, 1, 2, 14, 4, 8, 9, 5, 6, 7, 10, 11, 12, 13, 15, 16, 17];

const RACIALS: Record<string, string> = {
  'Blood Fury': 'RaceOrc',
  Berserking: 'RaceTroll',
  Stoneform: 'RaceDwarf',
  'Will of the Forsaken': 'RaceUndead',
  'War Stomp': 'RaceTauren',
  'Escape Artist': 'RaceGnome',
  Shadowmeld: 'RaceNightElf',
  'Gift of the Naaru': 'RaceDraenei',
  'Arcane Torrent': 'RaceBloodElf',
  'Mana Tap': 'RaceBloodElf',
};

/** Server-side data kept for building sims; not sent to the browser. */
export interface PlayerFightRaw {
  fight: PlayerFight;
  combatant?: WclCombatantInfo;
  consumes: DetectedConsumes;
  raceProto: string;
  /** Share of the fight the boss spent below 20% health (from the first Execute), if known. */
  executeProportion?: number;
  /** Whether the player had a pet out during the fight. */
  hasPet: boolean;
  /** Per-ability hit/crit/miss counts and average damage, for the RNG analysis. */
  outcomes: AbilityOutcome[];
  encounterId: number;
  encounterName: string;
}

export interface AbilityOutcome {
  name: string;
  total: number;
  /** Landed hits including crits and glancing blows. */
  landed: number;
  crits: number;
  /** Misses, dodges, parries and resists. */
  avoided: number;
  normalAvg: number;
  critAvg: number;
  /** Spells only, direct hits (not DoT ticks): damage lost to partial resists, and the damage those hits would have done unresisted. */
  resists?: { resisted: number; potential: number };
}

interface WclHitDetail {
  type: string;
  count: number;
  total: number;
}

function outcomeOf(name: string, e: WclTableEntry & { hitdetails?: WclHitDetail[]; missdetails?: WclHitDetail[]; critHitCount?: number }): AbilityOutcome {
  const detail = (type: string) => e.hitdetails?.find((h) => h.type === type);
  const normal = detail('Hit');
  const crit = detail('Critical Hit');
  return {
    name,
    total: e.total,
    landed: e.hitCount ?? 0,
    crits: e.critHitCount ?? crit?.count ?? 0,
    // Full spell misses aren't in missdetails/missCount on fresh; they show as casts without a hit.
    avoided:
      (e.missdetails ?? []).reduce((s, m) => s + m.count, 0) ||
      e.missCount ||
      (e.hitCount && e.uses ? Math.max(0, e.uses - e.hitCount) : 0),
    normalAvg: normal?.count ? normal.total / normal.count : 0,
    critAvg: crit?.count ? crit.total / crit.count : 0,
  };
}

// Totem buffs aren't logged on Anniversary, and Bloodlust is raid-wide there, so it doesn't show
// parties either. What does: Drums and Vampiric Touch mana (they only reach the user's party), and
// party-only auras with their caster (Moonkin Aura, Battle Shout, paladin auras...). Casts before
// the pull often aren't in the log, so a shaman in the party is assumed to keep the usual totems
// for the player's role up all fight, plus any other totem they cast. spec.totems says how strict
// to be (see SpecConfig).
export const PARTY_AURAS = [
  'Battle Shout',
  'Commanding Shout',
  'Moonkin Aura',
  'Leader of the Pack',
  'Trueshot Aura',
  'Unleashed Rage',
  'Ferocious Inspiration',
  'Sanctity Aura',
  'Devotion Aura',
  'Retribution Aura',
  'Concentration Aura',
  'Blood Pact',
  'Inspiring Presence',
  'Heroic Presence',
];
const TOTEM_BUFFS: Record<string, string> = {
  'Totem of Wrath': 'Totem of Wrath',
  'Wrath of Air Totem': 'Wrath of Air Totem',
  'Mana Spring Totem': 'Mana Spring',
  'Strength of Earth Totem': 'Strength of Earth',
  'Grace of Air Totem': 'Grace of Air',
};
// The totems a party shaman normally keeps up for a melee or caster party. Totem of Wrath needs an
// Elemental shaman. Windfury Totem is left out: its procs show in the log, so it's found from those.
const USUAL_TOTEMS: { name: string; id: number; icon: string; caster: boolean; elemental?: boolean }[] = [
  { name: 'Strength of Earth', id: 25528, icon: 'spell_nature_earthbindtotem', caster: false },
  { name: 'Wrath of Air Totem', id: 3738, icon: 'spell_nature_slowingtotem', caster: true },
  { name: 'Mana Spring', id: 25570, icon: 'spell_nature_manaregentotem', caster: true },
  { name: 'Totem of Wrath', id: 30706, icon: 'spell_fire_totemofwrath', caster: true, elemental: true },
];

// Vampiric Touch's mana (34919) and Drums of Battle / War / Greater Drums of Battle.
export const VAMPIRIC_TOUCH_MANA = 34919;
const PARTY_EVENT_SPELLS = new Set([VAMPIRIC_TOUCH_MANA, 35476, 35475, 351355]);

async function partyMembers(
  client: WclClient,
  report: string,
  start: number,
  end: number,
  source: number,
  auras: WclAura[],
  infos: (WclCombatantInfo & { sourceID: number })[],
): Promise<Set<number>> {
  const members = new Set<number>([source]);
  // Drums and Vampiric Touch mana only reach the user's party, so who got the same drum (at the
  // same moment) or mana from the same shadow priest shares the player's party. One call covers both.
  const events = await client.events('summary', report, start, end, {
    filter: `type in ("applybuff", "resourcechange") and ability.id in (${[...PARTY_EVENT_SPELLS].join(', ')})`,
  });
  const groups: Set<number>[] = [];
  const vtGroups = new Map<number, Set<number>>();
  // Each drum use reaches its party within a few milliseconds; a gap starts the next use.
  const lastDrum = new Map<number, { at: number; group: Set<number> }>();
  for (const e of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    if (e.sourceID === undefined || e.targetID === undefined || !e.ability || !PARTY_EVENT_SPELLS.has(e.ability.guid)) continue;
    let group: Set<number>;
    if (e.ability.guid === VAMPIRIC_TOUCH_MANA) {
      group = vtGroups.get(e.sourceID) ?? new Set([e.sourceID]);
      vtGroups.set(e.sourceID, group);
    } else {
      const last = lastDrum.get(e.sourceID);
      group = last && e.timestamp - last.at < 1000 ? last.group : new Set([e.sourceID]);
      lastDrum.set(e.sourceID, { at: e.timestamp, group });
    }
    group.add(e.targetID);
    if (!groups.includes(group)) groups.push(group);
  }
  for (const g of groups) if (g.has(source)) for (const id of g) members.add(id);
  // Auras up at the pull (Moonkin Aura, paladin auras...) are in everyone's combatant info, with
  // who cast them.
  const partyAuras = (info?: WclCombatantInfo) =>
    (info?.auras ?? []).filter((x) => PARTY_AURAS.includes(spellName(x.ability, x.name ?? ''))).map((x) => `${x.ability}:${x.source}`);
  const mine = new Set(partyAuras(infos.find((i) => i.sourceID === source)));
  for (const info of infos) if (partyAuras(info).some((k) => mine.has(k))) members.add(info.sourceID);
  if (members.size > 1) return members;
  // Otherwise buffs refreshed during the fight (Battle Shout) show who got them from the same caster.
  for (const aura of auras.filter((x) => PARTY_AURAS.includes(spellName(x.guid, x.name))).slice(0, 2)) {
    const events = await client.events('buffs', report, start, end, { abilityid: aura.guid });
    const givers = new Set(events.filter((e) => e.type === 'applybuff' && e.targetID === source).map((e) => e.sourceID));
    for (const e of events) if (e.type === 'applybuff' && givers.has(e.sourceID)) members.add(e.targetID!);
  }
  return members;
}

async function partyTotems(
  client: WclClient,
  fights: WclFightsResponse,
  report: string,
  fight: WclFight,
  caster: boolean,
  party: Set<number>,
  rule: SpecConfig['totems'],
): Promise<AuraUptime[]> {
  const { start_time: start, end_time: end } = fight;
  const inRaid = fights.friendlies.filter((a) => a.icon.startsWith('Shaman') && a.fights.some((f) => f.id === fight.id));
  // With no party-wide aura to go by, the party can't be worked out; any shaman in the raid could be
  // in it, so assume the usual totems (but not other totems their casts show, which may be elsewhere).
  const unknownParty = party.size === 1;
  if (unknownParty && rule === 'party') return [];
  const shamans = rule === 'raid' || unknownParty ? inRaid : inRaid.filter((a) => party.has(a.id));
  const totems = new Map<string, AuraUptime>();
  for (const shaman of shamans) {
    for (const t of USUAL_TOTEMS) {
      if (t.caster !== caster || (t.elemental && shaman.icon !== 'Shaman-Elemental')) continue;
      totems.set(t.name, { id: t.id, name: t.name, icon: t.icon, uptimePct: 100, uses: 0, fromPartyShaman: true, assumed: true });
    }
    if (unknownParty || !party.has(shaman.id)) continue;
    const casts = await client.events('casts', report, start - 120_000, end, { sourceid: shaman.id });
    for (const e of casts) {
      const name = e.ability && e.type === 'cast' && e.sourceID === shaman.id ? TOTEM_BUFFS[spellName(e.ability.guid, e.ability.name)] : undefined;
      if (!name) continue;
      const t = totems.get(name);
      if (t && !t.assumed) t.uses++;
      else totems.set(name, { id: e.ability!.guid, name, icon: e.ability!.abilityIcon, uptimePct: 100, uses: 1, fromPartyShaman: true });
    }
  }
  return [...totems.values()];
}

/**
 * Share of the player's direct shadow hits that landed with Improved Shadow Bolt up (0..100). The
 * debuff's time uptime understates it: warlocks cast into it, and it refreshes on their crits.
 * Each hit's target-side multiplier is amount / unmitigatedAmount; ISB makes it 20% higher, so hits
 * split into two groups. Partially resisted hits are left out (the resist changes the ratio).
 */
function isbShareOfHits(events: WclEvent[], source: number): number | undefined {
  const SHADOW = 32;
  const ratios = new Map<number, number[]>();
  for (const e of events) {
    if (e.type !== 'damage' || e.sourceID !== source || e.tick || e.resisted || e.ability?.type !== SHADOW) continue;
    if (typeof e.amount !== 'number' || typeof e.unmitigatedAmount !== 'number' || e.unmitigatedAmount <= 0) continue;
    // Crits and normal hits have different ratios; compare each with its own kind.
    const kind = typeof e.hitType === 'number' ? e.hitType : 1;
    ratios.set(kind, [...(ratios.get(kind) ?? []), e.amount / e.unmitigatedAmount]);
  }
  let withIsb = 0;
  let total = 0;
  for (const rs of ratios.values()) {
    const lo = Math.min(...rs);
    const hi = Math.max(...rs);
    // One group only: all with ISB or all without; too few hits to tell either way.
    if (hi / lo < 1.12) return undefined;
    withIsb += rs.filter((r) => r > lo * 1.1).length;
    total += rs.length;
  }
  return total >= 10 ? (withIsb / total) * 100 : undefined;
}

/** Hit chance from the combatant info's rating plus talents and party auras that add hit. */
function hitChance(spec: SpecConfig, combatant: WclCombatantInfo | undefined, talents: string, buffs: AuraUptime[]): PlayerFight['hit'] {
  const rating = combatant?.[spec.hit.stat];
  if (typeof rating !== 'number') return undefined;
  const fromRating = rating / spec.hit.perPct;
  const extras: string[] = [];
  let pct = fromRating;
  for (const t of spec.hit.talents) {
    const points = talentRank(spec.className, talents, t.name);
    if (points) {
      pct += points * t.pctPerPoint;
      extras.push(`${t.name} +${points * t.pctPerPoint}%`);
    }
  }
  const has = (name: string) => buffs.some((b) => b.name === name && b.uptimePct >= 50);
  // Draenei: Heroic Presence adds 1% to everything, Inspiring Presence 1% to spells.
  if (has('Heroic Presence') || (spec.caster && has('Inspiring Presence'))) {
    pct += 1;
    extras.push('Draenei aura +1%');
  }
  if (spec.caster && has('Totem of Wrath')) {
    pct += 3;
    extras.push('Totem of Wrath +3%');
  }
  return { pct, capPct: spec.hit.capPct, fromRating, extras };
}

/**
 * DPS a Power Infusion added: 20% cast speed for 15 s means 1/6 of the direct damage done under it
 * came from the haste. It doesn't stack with Bloodlust, so time under both doesn't count. DoT
 * ticks aren't hasted. Only measured for casters (their damage events are fetched anyway).
 */
function powerInfusionGain(auras: WclAura[], events: WclEvent[], source: number, durationSec: number): PlayerFight['powerInfusion'] {
  const pi = auras.find((a) => a.name === 'Power Infusion');
  if (!pi?.bands?.length) return undefined;
  const lust = auras.find((a) => a.name === 'Bloodlust' || a.name === 'Heroism')?.bands ?? [];
  const inside = (t: number, bands: { startTime: number; endTime: number }[]) => bands.some((b) => t >= b.startTime && t <= b.endTime);
  let damage = 0;
  for (const e of events) {
    if (e.type !== 'damage' || e.sourceID !== source || e.tick || typeof e.amount !== 'number') continue;
    if (inside(e.timestamp, pi.bands) && !inside(e.timestamp, lust)) damage += e.amount;
  }
  return { uses: pi.totalUses || pi.bands.length, dps: durationSec ? damage / 6 / durationSec : 0 };
}

export function findFight(fights: WclFightsResponse, fightId: number): WclFight {
  const fight = fights.fights.find((f) => f.id === fightId);
  if (!fight) throw new Error(`Fight ${fightId} not found in report`);
  return fight;
}

export async function collectPlayerFight(
  client: WclClient,
  spec: SpecConfig,
  report: string,
  fightId: number,
  source: number,
  extra: { rank?: number; server?: string; region?: string } = {},
): Promise<PlayerFightRaw> {
  const fights = await client.fights(report);
  const fight = findFight(fights, fightId);
  const actor = fights.friendlies.find((a) => a.id === source);
  if (!actor) throw new Error(`Player ${source} not found in report ${report}`);

  const start = fight.start_time;
  const end = fight.end_time;
  const durationMs = end - start;
  const durationSec = durationMs / 1000;
  const minutes = durationSec / 60;

  const [infos, damage, buffsTable, bossDebuffsTable, castEvents, executeHits, ownDebuffsTable, damageEvents, byTarget, taken] = await Promise.all([
    client.combatantInfos(report, start, end),
    client.table('damage-done', report, { start, end, sourceid: source }),
    client.buffs(report, start, end, source),
    client.bossDebuffs(report, start, end),
    client.events('casts', report, start, end, { sourceid: source }),
    spec.executeSpellId
      ? client.events('damage-done', report, start, end, { sourceid: source, abilityid: spec.executeSpellId })
      : Promise.resolve([]),
    spec.debuffUptimes ? client.bossDebuffs(report, start, end, actor.name) : Promise.resolve(undefined),
    // Casters: partial resists and which hits had Improved Shadow Bolt are only in the events.
    spec.caster ? client.events('damage-done', report, start, end, { sourceid: source }) : Promise.resolve([]),
    // The sim has one target; damage on adds doesn't count when comparing with it.
    client.table<{ entries: { total: number; type?: string }[] }>('damage-done', report, { start, end, sourceid: source, by: 'target' }),
    spec.rageFromDamageTaken ? client.table('damage-taken', report, { start, end, sourceid: source }) : Promise.resolve(undefined),
  ]);
  const combatant = infos.find((i) => i.sourceID === source);
  const resistedBySpell = new Map<number, number>();
  for (const e of damageEvents) {
    if (e.sourceID !== source || !e.ability || e.tick || typeof e.amount !== 'number') continue;
    // The log's "resisted" is 25/50/75% of the hit's base damage (before talents, debuffs and
    // crits), not of the damage lost. The resist applies to the final damage, so a 25% resist
    // means the hit lost a third of what landed.
    let resisted = 0;
    if (typeof e.resisted === 'number' && e.resisted > 0) {
      const base = typeof e.unmitigatedAmount === 'number' && e.unmitigatedAmount > 0 ? e.unmitigatedAmount : 0;
      const tier = base ? Math.min(0.75, Math.max(0.25, Math.round((e.resisted / base) * 4) / 4)) : 0;
      resisted = tier ? (e.amount * tier) / (1 - tier) : e.resisted;
    }
    resistedBySpell.set(e.ability.guid, (resistedBySpell.get(e.ability.guid) ?? 0) + resisted);
  }
  // Direct damage per spell (the table's hit details exclude DoT ticks), plus what was resisted.
  const resistsOf = (e: WclTableEntry & { hitdetails?: WclHitDetail[] }) => {
    const direct = (e.hitdetails ?? []).reduce((s, h) => s + h.total, 0);
    const resisted = resistedBySpell.get(e.guid) ?? 0;
    return direct ? { resisted, potential: direct + resisted } : undefined;
  };
  const isbHitPct = isbShareOfHits(damageEvents, source);
  // Temporary summons (Infernal, Doomguard) don't count: a warlock can sacrifice their pet and
  // still drop an Infernal.
  // Pet names are localized (a Korean log's Infernal is "지옥불정령"), so go by the summon icon.
  const TEMP_PET_ICON = /summon(infernal|doomguard)/i;
  const hasPet = (fights.friendlyPets ?? []).some(
    (p) => p.petOwner === source && !TEMP_PET_ICON.test(p.icon) && p.fights.some((f) => f.id === fightId),
  );
  // The first Execute marks when the boss dropped below 20% health.
  const firstExecute = executeHits.find((e) => e.type === 'damage')?.timestamp;
  const executeProportion = firstExecute ? Math.min(0.5, Math.max(0.05, (end - firstExecute) / durationMs)) : undefined;

  // Use TBC spell names everywhere so logs in any language compare by the same names.
  for (const e of damage.entries) e.name = spellName(e.guid, e.name);
  for (const a of [...buffsTable.auras, ...bossDebuffsTable.auras, ...(ownDebuffsTable?.auras ?? [])]) a.name = spellName(a.guid, a.name);
  for (const e of castEvents) if (e.ability) e.ability.name = spellName(e.ability.guid, e.ability.name);

  const totalDamage = damage.entries.reduce((sum, e) => sum + e.total, 0);
  const unmodeled = damage.entries.filter((e) => spec.sim.unmodeledDamage?.includes(e.name)).reduce((sum, e) => sum + e.total, 0);
  const bossDamage = byTarget.entries.filter((e) => e.type === 'Boss').reduce((sum, e) => sum + e.total, 0) || totalDamage;
  // Rage from damage taken at level 70: 2.5 rage per 274.7 damage.
  const takenTotal = taken?.entries.reduce((sum, e) => sum + e.total, 0) ?? 0;
  const mainTaken = taken?.entries.slice().sort((a, b) => b.total - a.total)[0];

  const gear: GearItem[] = [];
  for (const [index, slot] of Object.entries(WCL_SLOTS)) {
    const g = combatant?.gear[Number(index)];
    if (!g || !g.id) continue;
    const info = itemInfo(g.id);
    gear.push({
      slot,
      id: g.id,
      name: info?.n ?? `Item ${g.id}`,
      icon: info?.i ?? g.icon?.replace(/\.jpg$/, '') ?? 'inv_misc_questionmark',
      quality: info?.q ?? g.quality ?? 0,
      itemLevel: g.itemLevel ?? 0,
      enchantId: g.permanentEnchant || undefined,
      enchantName: g.permanentEnchant ? (enchantInfo(g.permanentEnchant)?.n ?? `Enchant ${g.permanentEnchant}`) : undefined,
      tempEnchantId: g.temporaryEnchant || undefined,
      tempEnchantName: g.temporaryEnchant ? (tempEnchantName(g.temporaryEnchant) ?? `Enchant ${g.temporaryEnchant}`) : undefined,
      gems: (g.gems ?? []).map((gem) => ({
        id: gem.id,
        name: gemInfo(gem.id)?.n ?? `Gem ${gem.id}`,
        icon: gemInfo(gem.id)?.i ?? 'inv_misc_gem_01',
      })),
    });
  }
  // Average item level the way the armory does it: all equipped slots except shirt/tabard.
  const ilvlSlots = gear.filter((g) => g.itemLevel > 0);
  const avgItemLevel = ilvlSlots.length ? ilvlSlots.reduce((s, g) => s + g.itemLevel, 0) / ilvlSlots.length : 0;

  const toUptime = (a: WclAura, total: number): AuraUptime => ({
    id: a.guid,
    name: a.name,
    icon: a.abilityIcon,
    uptimePct: total ? Math.min(100, (a.totalUptime / total) * 100) : 0,
    uses: a.totalUses,
    starts: a.bands?.map((b) => Math.max(0, (b.startTime - start) / 1000)),
  });
  // The player's party matters for totems and a shadow priest's Vampiric Touch mana; only worth
  // working out when the raid has someone who gives those.
  const givers = fights.friendlies.filter(
    (a) => a.id !== source && (a.icon.startsWith('Shaman') || a.icon === 'Priest-Shadow') && a.fights.some((f) => f.id === fightId),
  );
  const party = givers.length ? await partyMembers(client, report, start, end, source, buffsTable.auras, infos) : new Set([source]);
  // Vampiric Touch gives the party mana from the priest's shadow damage; WoWSims wants their DPS.
  let partyShadowPriestDps: number | undefined;
  for (const priest of givers.filter((a) => a.icon === 'Priest-Shadow' && party.has(a.id))) {
    const t = await client.table<{ entries: { total: number }[] }>('damage-done', report, { start, end, sourceid: priest.id });
    partyShadowPriestDps = Math.max(partyShadowPriestDps ?? 0, t.entries.reduce((sum, e) => sum + e.total, 0) / durationSec);
  }
  const buffs = [...buffsTable.auras.map((a) => toUptime(a, buffsTable.totalTime)), ...(await partyTotems(client, fights, report, fight, spec.caster, party, spec.totems))]
    .sort((a, b) => b.uptimePct - a.uptimePct);
  const bossDebuffs = bossDebuffsTable.auras
    .map((a) => toUptime(a, bossDebuffsTable.totalTime))
    .sort((a, b) => b.uptimePct - a.uptimePct);

  // Casts per ability (ranks grouped by name), counted from the cast events.
  const castsByName = new Map<string, AbilityCasts>();
  for (const e of castEvents) {
    if (e.type !== 'cast' || e.sourceID !== source || !e.ability) continue;
    const existing = castsByName.get(e.ability.name);
    if (existing) existing.casts++;
    else castsByName.set(e.ability.name, { id: e.ability.guid, name: e.ability.name, icon: e.ability.abilityIcon, casts: 1, perMinute: 0 });
  }
  // Some abilities (e.g. Execute on fresh) are missing from the casts table but show up as
  // damage; fill those in from the damage table for abilities the spec cares about.
  const watched = new Set([...spec.trackedCasts.map((t) => t.name), ...spec.gcdAbilities]);
  const fromDamage = new Map<string, number>();
  for (const e of damage.entries) {
    if (!watched.has(e.name) || castsByName.has(e.name)) continue;
    const count = e.uses ?? (e.hitCount ?? 0) + (e.missCount ?? 0);
    if (!count) continue;
    castsByName.set(e.name, { id: e.guid, name: e.name, icon: e.abilityIcon, casts: count, perMinute: 0 });
    fromDamage.set(e.name, count);
  }
  const casts = [...castsByName.values()]
    .map((c) => ({ ...c, perMinute: minutes ? c.casts / minutes : 0 }))
    .sort((a, b) => b.casts - a.casts);

  const castList = castEvents
    .filter((e) => e.type === 'cast' && e.sourceID === source && e.ability)
    .map((e) => ({ t: (e.timestamp - start) / 1000, id: e.ability!.guid, name: e.ability!.name, icon: e.ability!.abilityIcon }));

  // Active time: cast-time spells are busy from begincast to cast; instants on the GCD take one
  // GCD. Execute is missing from cast events on fresh, so its damage events stand in for casts.
  const gcdSet = new Set(spec.gcdAbilities);
  const busy: [number, number][] = [];
  const pending = new Map<number, number>();
  // Channels (Mind Flay, Arcane Missiles) have one cast event at the start: busy until the channel's
  // full length or the player's next action, whichever comes first.
  const actionTimes = castEvents
    .filter((e) => e.sourceID === source && (e.type === 'cast' || e.type === 'begincast'))
    .map((e) => (e.timestamp - start) / 1000);
  for (const e of castEvents) {
    if (e.sourceID !== source || !e.ability) continue;
    const t = (e.timestamp - start) / 1000;
    const channelSec = e.type === 'cast' ? spec.channels?.[e.ability.name] : undefined;
    if (channelSec) {
      const next = actionTimes.find((x) => x > t + 0.05) ?? Infinity;
      busy.push([t, Math.max(t + spec.gcdSec * 0.66, Math.min(t + channelSec, next))]);
      continue;
    }
    if (e.type === 'begincast') {
      pending.set(e.ability.guid, t);
    } else if (e.type === 'cast') {
      const began = pending.get(e.ability.guid);
      pending.delete(e.ability.guid);
      if (began !== undefined && t - began < 15) busy.push([began, Math.max(t, began + spec.gcdSec * 0.66)]);
      else if (gcdSet.has(e.ability.name)) busy.push([t, t + spec.gcdSec]);
    }
  }
  if (!castList.some((c) => c.name === 'Execute')) {
    for (const e of executeHits) if (e.type === 'damage') busy.push([(e.timestamp - start) / 1000, (e.timestamp - start) / 1000 + spec.gcdSec]);
  }
  busy.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of busy) {
    const last = merged.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([Math.max(0, a), Math.min(b, durationSec)]);
  }
  const busySec = merged.reduce((s, [a, b]) => s + Math.max(0, b - a), 0);
  const activePct = durationSec ? Math.min(100, (busySec / durationSec) * 100) : 0;
  const gaps: { start: number; duration: number }[] = [];
  let prevEnd = 0;
  for (const [a, b] of [...merged, [durationSec, durationSec] as [number, number]]) {
    // A short gap at the very start is just the pull (pre-cast landing, running in), not idle time.
    const pullGap = prevEnd === 0 && a < 2.5;
    if (a - prevEnd >= spec.gapThresholdSec && !pullGap) gaps.push({ start: Math.round(prevEnd * 10) / 10, duration: Math.round((a - prevEnd) * 10) / 10 });
    prevEnd = Math.max(prevEnd, b);
  }
  gaps.sort((x, y) => y.duration - x.duration);
  const idleSec = Math.max(0, durationSec - busySec);

  const abilityEfficiency = spec.efficiency.map(({ name, cooldownSec, delaySec = 0 }) => {
    const possible = Math.max(1, Math.floor((durationSec - delaySec) / cooldownSec) + 1);
    const used = castsByName.get(name)?.casts ?? 0;
    return { name, pct: Math.min(100, (used / possible) * 100) };
  });

  const cooldowns: CooldownUse[] = spec.cooldowns
    .map((name) => {
      const uses = castList.filter((c) => c.name === name);
      return { name: castLabel(spec, name), icon: uses[0]?.icon, times: uses.map((u) => Math.round(u.t * 10) / 10) };
    })
    .filter((c) => c.times.length > 0);

  const mh = combatant?.gear[15];
  const oh = combatant?.gear[16];
  const consumes = detectConsumes({
    buffs: buffs.map((b) => ({ id: b.id, name: b.name, icon: b.icon })),
    casts: casts.map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
    mhTempEnchant: mh?.temporaryEnchant,
    ohTempEnchant: oh?.temporaryEnchant,
  });

  const racialCast = casts.find((c) => RACIALS[c.name]);
  const isHorde = combatant?.faction === 0;
  const raceProto = racialCast
    ? RACIALS[racialCast.name]
    : isHorde
      ? spec.sim.defaultRace.horde
      : spec.sim.defaultRace.alliance;

  const logTalents = combatant?.talents ?? [];
  const talentSplit: [number, number, number] = [logTalents[0]?.id ?? 0, logTalents[1]?.id ?? 0, logTalents[2]?.id ?? 0];
  // Real talents from the armory when its spec matches the log's split; otherwise a preset.
  const armory = await armoryTalents(
    spec.className,
    actor.name,
    extra.server ?? actor.server,
    extra.region ? [extra.region] : ['eu', 'us'],
    talentSplit,
  );
  const talents = armory?.talents ?? closestTalentPreset(spec, talentSplit);

  const hit = hitChance(spec, combatant, talents, buffs);
  // Power Infusion is cast speed, so it only matters (and is only measured) for casters.
  const powerInfusion = spec.caster ? powerInfusionGain(buffsTable.auras, damageEvents, source, durationSec) : undefined;

  // Your own debuffs on the boss (curses, DoTs).
  const ownDebuffs = (ownDebuffsTable?.auras ?? [])
    .filter((a) => spec.debuffUptimes?.includes(a.name))
    .map((a) => toUptime(a, ownDebuffsTable!.totalTime));

  return {
    combatant,
    consumes,
    raceProto,
    executeProportion,
    hasPet,
    outcomes: damage.entries
      .map((e) => ({ ...outcomeOf(e.guid === 1 ? 'Melee' : e.name, e), ...(spec.caster ? { resists: resistsOf(e) } : {}) }))
      .filter((o) => o.landed + o.avoided > 0),
    encounterId: fight.boss,
    encounterName: fight.name,
    fight: {
      name: actor.name,
      server: extra.server ?? actor.server,
      report,
      fight: fightId,
      source,
      rank: extra.rank,
      className: spec.className,
      specName: spec.specName,
      race: raceProto.replace(/^Race/, '').replace(/([a-z])([A-Z])/g, '$1 $2') + (racialCast ? '' : ' (guess)'),
      durationSec,
      kill: fight.kill ?? false,
      totalDamage,
      dps: durationSec ? totalDamage / durationSec : 0,
      // Boss damage, less the share from things the sim can't model (e.g. an Infernal).
      simComparableDps: durationSec && totalDamage ? (bossDamage * (1 - unmodeled / totalDamage)) / durationSec : 0,
      avgItemLevel,
      talentSplit,
      talents,
      talentSource: armory ? 'armory' : 'preset',
      gear,
      buffs,
      casts,
      consumes: consumes.list,
      cooldowns,
      activePct,
      gaps: gaps.slice(0, 25),
      idleSec,
      ...(isbHitPct !== undefined ? { isbHitPct } : {}),
      ...(hit ? { hit } : {}),
      ...(partyShadowPriestDps ? { partyShadowPriestDps } : {}),
      ...(powerInfusion ? { powerInfusion } : {}),
      ...(taken && minutes ? { rageFromDamageTaken: { perMinute: ((takenTotal * 2.5) / 274.7) / minutes, mainSource: mainTaken && spellName(mainTaken.guid, mainTaken.name) } } : {}),
      abilityEfficiency,
      bossDebuffs,
      ownDebuffs,
    },
  };
}
