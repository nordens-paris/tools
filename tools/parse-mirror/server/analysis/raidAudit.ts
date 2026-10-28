// The officer checks on the whole-raid page: gear problems, party setup, raid debuffs on the boss
// and potions. Built from what the raid summary fetches anyway (combatant info), plus two calls per
// boss kill: the boss debuff table, and one event query for drums, Vampiric Touch mana and potions.
import type { GearIssue, GuildFight, GuildSummary, RaidParty } from '../../shared/types.ts';
import { detectConsumes } from '../data/consumes.ts';
import { gemInfo, itemInfo, spellName } from '../data/db.ts';
import { talentRank } from '../data/talents.ts';
import { closestTalentPreset } from '../sim/request.ts';
import { specForIcon } from '../specs/index.ts';
import type { WclClient } from '../wcl/client.ts';
import type { WclActor, WclCombatantInfo, WclEvent, WclFight } from '../wcl/types.ts';
import { PARTY_AURAS, VAMPIRIC_TOUCH_MANA, WCL_SLOTS } from './collect.ts';

type Info = WclCombatantInfo & { sourceID: number };

// Specs that don't parse on DPS.
export const NOT_DPS = new Set([
  'Priest-Holy',
  'Priest-Discipline',
  'Paladin-Holy',
  'Paladin-Protection',
  'Druid-Restoration',
  'Druid-Guardian',
  'Shaman-Restoration',
  'Warrior-Protection',
]);

// Weapon oils are only checked for casters and healers: a melee weapon's Windfury Totem enchant
// comes and goes, so a missing stone at the pull can't be told apart from a totem in between pulses.
const OIL_USERS = /^(Mage|Warlock|Priest|Paladin-Holy|Druid-(Balance|Restoration))/;

type Consumes = NonNullable<GuildFight['consumes']>;
// Consume categories shown per kill, grouped the way the raid pages show them.
const USED_CATEGORY: Partial<Record<string, Consumes['used'][number]['category']>> = {
  Flask: 'Flask',
  'Battle Elixir': 'Elixir',
  'Guardian Elixir': 'Elixir',
  Food: 'Food',
  'Weapon (MH)': 'Weapon',
  'Weapon (OH)': 'Weapon',
  Scroll: 'Scroll',
};
// Weapon enchants we don't know by ID are a shaman's own imbue or a rogue's poison.
function weaponLabel(name: string, icon: string | undefined, playerIcon: string) {
  if (!name.startsWith('Unknown (enchant')) return { name, icon };
  if (playerIcon.startsWith('Shaman')) return { name: 'Shaman weapon imbue', icon: 'spell_nature_cyclone' };
  if (playerIcon.startsWith('Rogue')) return { name: 'Poison', icon: 'ability_poisons' };
  return { name, icon: 'inv_misc_questionmark' };
}

/** Flask/elixirs, food, weapon oil and scrolls at the pull. Missing when the player was out of range. */
export function consumesAt(info: Info | undefined, playerIcon: string): Consumes | undefined {
  if (!info) return undefined;
  const found = detectConsumes({
    buffs: (info.auras ?? []).map((a) => ({ id: a.ability, name: spellName(a.ability, a.name ?? ''), icon: a.icon?.replace(/\.jpg$/, '') })),
    casts: [],
    mhTempEnchant: info.gear?.[15]?.temporaryEnchant,
    ohTempEnchant: info.gear?.[16]?.temporaryEnchant,
  }).list;
  const has = (...categories: string[]) => found.some((c) => categories.includes(c.category));
  return {
    flask: has('Flask') || (has('Battle Elixir') && has('Guardian Elixir')) ? 'full' : has('Battle Elixir', 'Guardian Elixir') ? 'half' : 'none',
    food: has('Food'),
    weapon: OIL_USERS.test(playerIcon) ? has('Weapon (MH)') : undefined,
    used: found.flatMap((c) => {
      const category = USED_CATEGORY[c.category];
      return category ? [{ category, ...weaponLabel(c.name, c.icon, playerIcon) }] : [];
    }),
  };
}

/**
 * Whether a caster had Totem of Wrath's 3% hit: an Elemental shaman in their party (any party for
 * warlocks, whose spec assumes it raid-wide).
 */
export function hasTotemOfWrath(player: WclActor, actors: WclActor[], infos: Info[], groups: RaidParty[]) {
  const elemental = (id: number) => actors.find((x) => x.id === id)?.icon === 'Shaman-Elemental';
  if (player.icon.startsWith('Warlock')) return infos.some((i) => elemental(i.sourceID));
  return groups.some((g) => g.members.includes(player.id) && g.members.some(elemental));
}

const DRUMS = [35476, 35475, 351355, 35477, 35478];
// Potions (cast spell IDs) and the runes that share their purpose. Thistle Tea is a rogue's potion.
const POTIONS = [28507, 28508, 28494, 28506, 17528, 28515, 28499, 28495, 17531, 17534, 38929, 22729, 9512];
const RUNES = [27869, 16666];

/** Two calls per kill: boss debuffs, and drums/Vampiric Touch mana/potion events. */
export async function fetchRaidEvents(client: WclClient, report: string, f: WclFight) {
  const ids = (xs: number[]) => xs.join(', ');
  const [debuffs, events] = await Promise.all([
    client.bossDebuffs(report, f.start_time, f.end_time),
    // Pre-pull potions are drunk a second or two before the pull.
    client.events('summary', report, f.start_time - 5000, f.end_time, {
      filter:
        `(type = "cast" and ability.id in (${ids([...POTIONS, ...RUNES, ...DRUMS])})) or ` +
        `(type in ("applybuff", "resourcechange") and ability.id in (${ids([...DRUMS, VAMPIRIC_TOUCH_MANA])}))`,
    }),
  ]);
  return { debuffs, events };
}

/** Potions and runes each player used on the kill. */
export function potionsUsed(events: WclEvent[], source: number) {
  return events
    .filter((e) => e.type === 'cast' && e.sourceID === source && e.ability && (POTIONS.includes(e.ability.guid) || RUNES.includes(e.ability.guid)))
    .map((e) => ({ name: potionName(e.ability!.guid, e.ability!.name), icon: e.ability!.abilityIcon?.replace(/\.jpg$/, '') }));
}
// Potion casts are named after their effect ("Haste", "Restore Mana").
const POTION_NAMES: Record<number, string> = {
  28507: 'Haste Potion',
  28508: 'Destruction Potion',
  28499: 'Super Mana Potion',
  28495: 'Super Healing Potion',
  28515: 'Ironshield Potion',
  17531: 'Major Mana Potion',
  17534: 'Major Healing Potion',
  9512: 'Thistle Tea',
};
const potionName = (id: number, name: string) => POTION_NAMES[id] ?? name;

// Roles for the party checks. Hunters aren't "melee": they don't use Windfury.
const MELEE = /^(Warrior-(Fury|Arms)|Rogue|Shaman-Enhancement|Druid-Feral|Paladin-Retribution)/;
const CASTER = /^(Mage|Warlock|Priest-Shadow|Shaman-Elemental|Druid-Balance)/;
const MANA_USER = /^(Mage|Warlock|Priest|Shaman|Druid-(Balance|Restoration)|Paladin|Hunter)/;
const PHYSICAL = /^(Warrior-(Fury|Arms)|Rogue|Shaman-Enhancement|Druid-Feral|Paladin-Retribution|Hunter)/;

/**
 * Parties on one kill, from what only reaches a party: the same drum use, mana from the same
 * shadow priest's Vampiric Touch, and party auras with their caster in the combatant info.
 */
export function partiesOf(actors: WclActor[], infos: Info[], events: WclEvent[]): { groups: RaidParty[] } {
  const ids = new Set(actors.map((a) => a.id));
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const join = (a: number, b: number) => {
    if (!ids.has(a) || !ids.has(b)) return;
    parent.set(find(a), find(b));
  };

  const drumUses = new Map<number, { at: number; group: number[] }[]>();
  const drumIcon = events.find((e) => e.ability && DRUMS.includes(e.ability.guid))?.ability?.abilityIcon?.replace(/\.jpg$/, '');
  for (const e of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    if (e.type === 'cast' || e.sourceID === undefined || e.targetID === undefined || !e.ability) continue;
    if (e.ability.guid === VAMPIRIC_TOUCH_MANA) join(e.sourceID, e.targetID);
    else if (DRUMS.includes(e.ability.guid)) {
      // Each drum use reaches its party within a few milliseconds.
      const uses = drumUses.get(e.sourceID) ?? [];
      const last = uses.at(-1);
      if (last && e.timestamp - last.at < 1000) last.group.push(e.targetID);
      else uses.push({ at: e.timestamp, group: [e.sourceID, e.targetID] });
      drumUses.set(e.sourceID, uses);
      join(e.sourceID, e.targetID);
    }
  }
  const byAura = new Map<string, number>();
  for (const info of infos) {
    for (const a of info.auras ?? []) {
      if (!PARTY_AURAS.includes(spellName(a.ability, a.name ?? '')) || a.source === undefined) continue;
      const key = `${a.ability}:${a.source}`;
      const other = byAura.get(key);
      if (other !== undefined) join(other, info.sourceID);
      else byAura.set(key, info.sourceID);
      // The caster of a party aura is in that party too (pets aren't players, so they're skipped).
      join(a.source, info.sourceID);
    }
  }

  const clusters = new Map<number, number[]>();
  for (const a of actors) clusters.set(find(a.id), [...(clusters.get(find(a.id)) ?? []), a.id]);
  const icon = (id: number) => actors.find((a) => a.id === id)?.icon ?? '';
  const name = (id: number) => actors.find((a) => a.id === id)?.name ?? '?';
  const known = [...clusters.values()].filter((m) => m.length > 1).sort((a, b) => b.length - a.length);
  // A raid has at most one party per five players.
  const maxGroups = Math.max(1, Math.ceil(actors.length / 5));
  const unplaced = [...clusters.values()].filter((m) => m.length === 1).map((m) => m[0]);
  const groups: RaidParty[] = known.map((members) => ({
    members: [...members],
    guessed: [],
    drums: [...drumUses.entries()].filter(([src]) => members.includes(src)).reduce((n, [, uses]) => n + uses.length, 0),
    drumIcon,
    notes: [],
  }));
  // Pieces of the same party that nothing tied together are joined (smallest first, while they
  // fit), then the rest are seated by guess.
  while (groups.length > maxGroups) {
    const small = groups.pop()!;
    const into = groups.filter((g) => g.members.length + small.members.length <= 5).sort((a, b) => a.members.length - b.members.length)[0] ?? groups.at(-1)!;
    into.members.push(...small.members);
    into.guessed.push(...small.members);
    into.drums += small.drums;
  }
  for (const id of unplaced) {
    let target = bestSeat(groups, id, icon);
    if (!target && groups.length < maxGroups) groups.push((target = { members: [], guessed: [], drums: 0, drumIcon, notes: [] }));
    target ??= groups.reduce((a, b) => (b.members.length < a.members.length ? b : a));
    target.members.push(id);
    target.guessed.push(id);
  }
  // Setup notes go by the members we're sure of. A guessed player may really belong to a party that
  // isn't full, so notes about something missing (no shaman, nobody to benefit) need the party to
  // be full, or nobody (no shaman, for shaman notes) to have been guessed.
  const guessed = groups.flatMap((g) => g.guessed);
  const shamanGuessed = guessed.some((id) => icon(id).startsWith('Shaman'));
  for (const g of groups) {
    const sure = g.members.filter((id) => !g.guessed.includes(id));
    if (sure.length < 2) continue;
    const full = sure.length >= 5;
    g.notes = partyNotes(
      sure.map((id) => ({ icon: icon(id), name: name(id) })),
      full || !shamanGuessed,
      full || !guessed.length,
    );
  }
  return { groups };
}

const roleOf = (icon: string) => (MELEE.test(icon) ? 'melee' : CASTER.test(icon) ? 'caster' : icon.startsWith('Hunter') ? 'hunter' : 'other');

/** The party with room that looks most like the player's role (melee with melee...). */
function bestSeat(groups: RaidParty[], id: number, icon: (id: number) => string): RaidParty | undefined {
  const role = roleOf(icon(id));
  let best: RaidParty | undefined;
  let bestScore = -1;
  for (const g of groups) {
    if (g.members.length >= 5) continue;
    const score = g.members.filter((m) => roleOf(icon(m)) === role).length * 10 + g.members.length;
    if (score > bestScore) {
      best = g;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Setup notes for the members we're sure of. `shamanKnown`: no guessed shaman could belong here.
 * `complete`: no guessed player could belong here (for "helps no one" notes).
 */
function partyNotes(members: { icon: string; name: string }[], shamanKnown: boolean, complete: boolean): string[] {
  const notes: string[] = [];
  const names = (re: RegExp) => members.filter((m) => re.test(m.icon)).map((m) => m.name);
  const shamans = members.filter((m) => m.icon.startsWith('Shaman'));
  const melee = names(MELEE).filter((n) => !shamans.some((s) => s.name === n));
  const casters = names(CASTER).filter((n) => !shamans.some((s) => s.name === n));
  if (shamanKnown && melee.length && !shamans.some((s) => s.icon !== 'Shaman-Elemental')) notes.push(`No Windfury Totem for ${melee.join(', ')}`);
  if (shamanKnown && casters.length && !shamans.length) notes.push(`No Wrath of Air or Mana Spring for ${casters.join(', ')}`);
  const priests = names(/^Priest-Shadow/);
  const manaUsers = members.filter((m) => MANA_USER.test(m.icon) && !priests.includes(m.name));
  if (complete && priests.length && !manaUsers.length) notes.push(`${priests.join(', ')}'s Vampiric Touch mana reaches no one who uses mana`);
  const ferals = names(/^Druid-Feral/);
  if (complete && ferals.length && members.filter((m) => PHYSICAL.test(m.icon)).length <= ferals.length) notes.push(`Leader of the Pack (${ferals.join(', ')}) helps no other physical DPS here`);
  const moonkins = names(/^Druid-Balance/);
  if (complete && moonkins.length && casters.filter((n) => !moonkins.includes(n)).length === 0) notes.push(`Moonkin Aura (${moonkins.join(', ')}) helps no other caster here`);
  return notes;
}

// Raid debuffs on the boss, with the classes or specs that bring each. Matched by spell ID where the
// log's name is ambiguous: Improved Shadow Bolt and Shadow Weaving are both "Shadow Vulnerability".
// Sunder and Expose Armor don't stack, so they're one row; uptime is the better of the matches.
// (Blood Frenzy isn't in the log as a debuff, so it's left out.)
// target: uptime that counts as good. Improved Shadow Bolt depends on warlocks' crits, so it's lower.
const RAID_DEBUFFS: { name: string; by: string[]; names?: string[]; ids?: number[]; icon: string; target?: number }[] = [
  { name: 'Sunder or Expose Armor', by: ['Warrior', 'Rogue'], names: ['Sunder Armor', 'Expose Armor'], icon: 'ability_warrior_sunder' },
  { name: 'Faerie Fire', by: ['Druid'], names: ['Faerie Fire', 'Faerie Fire (Feral)'], icon: 'spell_nature_faeriefire' },
  { name: 'Curse of Recklessness', by: ['Warlock'], icon: 'spell_shadow_unholystrength' },
  { name: 'Curse of the Elements', by: ['Warlock'], icon: 'spell_shadow_chilltouch' },
  { name: 'Improved Shadow Bolt', by: ['Warlock'], ids: [17794, 17797, 17798, 17799, 17800], icon: 'spell_shadow_shadowbolt', target: 60 },
  { name: 'Misery', by: ['Priest-Shadow'], icon: 'spell_shadow_misery' },
  { name: 'Shadow Weaving', by: ['Priest-Shadow'], ids: [15258], icon: 'spell_shadow_blackplague' },
  { name: 'Judgement of the Crusader', by: ['Paladin'], icon: 'spell_holy_holysmite' },
  { name: 'Judgement of Wisdom', by: ['Paladin'], icon: 'spell_holy_righteousnessaura' },
  { name: 'Improved Scorch', by: ['Mage-Fire'], ids: [22959], icon: 'spell_fire_soulburn' },
  { name: "Winter's Chill", by: ['Mage-Frost'], ids: [12579], icon: 'spell_frost_chillingblast' },
  { name: "Hunter's Mark", by: ['Hunter'], icon: 'ability_hunter_snipershot' },
  { name: 'Expose Weakness', by: ['Hunter-Survival'], icon: 'ability_rogue_findweakness' },
  { name: 'Mangle', by: ['Druid-Feral', 'Druid-Guardian'], names: ['Mangle (Cat)', 'Mangle (Bear)'], icon: 'ability_druid_mangle2' },
];

export function raidDebuffs(
  kills: WclFight[],
  tables: Map<number, { totalTime: number; auras: { guid: number; name: string; abilityIcon?: string; totalUptime: number }[] }>,
  actors: WclActor[],
): GuildSummary['debuffs'] {
  const out: GuildSummary['debuffs'] = [];
  for (const d of RAID_DEBUFFS) {
    const matches = (a: { guid: number; name: string }) => (d.ids ? d.ids.includes(a.guid) : (d.names ?? [d.name]).includes(spellName(a.guid, a.name)));
    const uptime: Record<number, number> = {};
    for (const f of kills) {
      const t = tables.get(f.id);
      const best = Math.max(0, ...(t?.auras ?? []).filter(matches).map((a) => a.totalUptime));
      uptime[f.id] = t?.totalTime ? Math.min(100, (best / t.totalTime) * 100) : 0;
    }
    const bringers = d.by.filter((by) => actors.some((a) => a.icon === by || a.icon.startsWith(`${by}-`)));
    if (!bringers.length && !Object.values(uptime).some((u) => u > 0)) continue;
    out.push({ name: d.name, icon: d.icon, by: (bringers.length ? bringers : d.by).map((b) => b.replace('-', ' ')).join(' or '), uptime, target: d.target ?? 90 });
  }
  return out;
}

// The raid debuffs that raise a player's damage, by the kind of damage they do. Healers get none.
const PHYSICAL_DEBUFFS = ['Sunder or Expose Armor', 'Faerie Fire', 'Curse of Recklessness', 'Judgement of the Crusader', "Hunter's Mark", 'Expose Weakness'];
const SPELL_DEBUFFS = ['Curse of the Elements', 'Misery', 'Judgement of the Crusader'];
export function debuffsFor(icon: string): string[] {
  if (NOT_DPS.has(icon)) return [];
  // Mangle's 30% more bleed damage (and Shred) matters to ferals, rogues and Arms' Deep Wounds.
  if (PHYSICAL.test(icon)) return /^(Druid-Feral|Rogue|Warrior-Arms)/.test(icon) ? [...PHYSICAL_DEBUFFS, 'Mangle'] : PHYSICAL_DEBUFFS;
  const extra = /^(Warlock|Priest-Shadow)/.test(icon) ? ['Shadow Weaving', 'Improved Shadow Bolt'] : icon === 'Mage-Fire' ? ['Improved Scorch'] : icon === 'Mage-Frost' ? ["Winter's Chill"] : [];
  return CASTER.test(icon) ? [...SPELL_DEBUFFS, ...extra] : [];
}

// Slots worth an enchant for everyone. Rings are enchanter-only; ranged only matters for hunters.
const ENCHANT_SLOTS = ['Head', 'Shoulder', 'Back', 'Chest', 'Wrist', 'Hands', 'Legs', 'Feet', 'Main Hand', 'Off Hand'];

/** Missing enchants, empty sockets, green gems, and hit under the cap for the specs we know. */
export function gearIssues(icon: string, info: Info, totemOfWrath: boolean): GearIssue[] {
  const issues: GearIssue[] = [];
  for (const [index, slot] of Object.entries(WCL_SLOTS)) {
    const g = info.gear?.[Number(index)];
    if (!g?.id) continue;
    const data = itemInfo(g.id);
    const item = { id: g.id, name: data?.n ?? `Item ${g.id}`, icon: data?.i ?? 'inv_misc_questionmark', quality: data?.q ?? g.quality ?? 0 };
    const enchantable = ENCHANT_SLOTS.includes(slot) || (slot === 'Ranged' && icon.startsWith('Hunter'));
    // Held-in-off-hand items and tabards can't be enchanted.
    if (enchantable && !g.permanentEnchant && !(slot === 'Off Hand' && data?.o)) issues.push({ kind: 'enchant', slot, item, text: `${slot}: no enchant` });
    const gems = (g.gems ?? []).filter((x) => x.id);
    const empty = (data?.s ?? 0) - gems.length;
    if (empty > 0) issues.push({ kind: 'socket', slot, item, text: `${slot}: ${empty} empty socket${empty > 1 ? 's' : ''}` });
    const green = gems.filter((x) => (gemInfo(x.id)?.q ?? 3) <= 2).length;
    if (green) issues.push({ kind: 'gem', slot, item, text: `${slot}: ${green} green gem${green > 1 ? 's' : ''}` });
  }
  const hit = hitShort(icon, info, totemOfWrath);
  if (hit) issues.push({ kind: 'hit', text: hit });
  return issues;
}

/**
 * Hit under the cap, for the specs with a full analysis: rating plus the talents of the closest
 * standard build, party auras at the pull, and Totem of Wrath when the player had it (see
 * guild.ts). Only flagged a full percent or more below the cap.
 */
function hitShort(icon: string, info: Info, totemOfWrath: boolean): string | undefined {
  const split: [number, number, number] = [info.talents?.[0]?.id ?? 0, info.talents?.[1]?.id ?? 0, info.talents?.[2]?.id ?? 0];
  const spec = specForIcon(icon, split);
  const rating = spec ? info[spec.hit.stat] : undefined;
  if (!spec || typeof rating !== 'number') return undefined;
  const talents = closestTalentPreset(spec, split);
  let pct = rating / spec.hit.perPct;
  for (const t of spec.hit.talents) pct += talentRank(spec.className, talents, t.name) * t.pctPerPoint;
  const auras = (info.auras ?? []).map((a) => spellName(a.ability, a.name ?? ''));
  if (auras.includes('Heroic Presence') || (spec.caster && auras.includes('Inspiring Presence'))) pct += 1;
  if (spec.caster && totemOfWrath) pct += 3;
  if (pct >= spec.hit.capPct - 1) return undefined;
  return `Hit ${pct.toFixed(1)}% of ${spec.hit.capPct}%${spec.caster && totemOfWrath ? ' (with Totem of Wrath)' : ''}`;
}
