// Everything a healer analysis needs from one fight, raid-wide, so a single fetch covers every
// healer in the raid. About 7 requests, more on long fights (each request returns up to 10,000
// events, and the rest is fetched page by page). Report data is cached forever, so a second healer
// from the same raid costs nothing.
import type { WclReader } from '../../wcl/reader.ts';
import type { WclActor, WclCombatantInfo, WclEvent, WclFight, WclFightsResponse } from '../../wcl/types.ts';


/** A table row split by actor (healing done, damage taken). Icons carry the spec. */
export interface ActorTableEntry {
  id: number;
  name: string;
  icon: string;
  type: string;
  total: number;
  overheal?: number;
}

export interface HealerFightData {
  report: string;
  fight: WclFight;
  players: WclActor[];
  healing: WclEvent[];
  damage: WclEvent[];
  casts: WclEvent[];
  buffs: WclEvent[];
  deaths: WclEvent[];
  /** Mana gains (potions, Mana Tide, Shadowfiend...). */
  resources: WclEvent[];
  combatants: (WclCombatantInfo & { sourceID: number })[];
  /** Healing done per player: spec icons and totals. */
  healingDone: ActorTableEntry[];
  /** The boss's melee taken per player: finds the tanks. */
  meleeTaken: ActorTableEntry[];
  /** Teron Gorefiend's Shadow of Death debuffs (empty on other fights): a ghost can't heal. */
  shadowOfDeath?: WclEvent[];
}

const CAST_TYPES = ['cast', 'begincast'];
const BUFF_TYPES = ['applybuff', 'applybuffstack', 'refreshbuff', 'removebuff', 'removebuffstack'];
const TERON = new Set([601, 50604]);
const SHADOW_OF_DEATH = 40251;

/** The event fields the healer and tank metrics read; the rest is dropped before caching. */
export const FIELDS = [
  'timestamp',
  'type',
  'sourceID',
  'targetID',
  'sourceIsFriendly',
  'ability',
  'amount',
  'overheal',
  'absorbed',
  'tick',
  'hitPoints',
  'resourceActor',
  'classResources',
  'stack',
  'resourceChange',
  'resourceChangeType',
  'waste',
  // How each hit landed, for the tank metrics: hit type (dodge, parry, block, crushing...),
  // what it would have done, and what armor, block and absorbs took off.
  'hitType',
  'unmitigatedAmount',
  'mitigated',
  'blocked',
  // The actor's armor at the time (combatant info has it only at the pull, before a bear shifts).
  'armor',
] as const;

/** Raid-wide healer data for one fight. */
export async function fetchHealerFight(client: WclReader, report: string, fightId: number, fights?: WclFightsResponse): Promise<HealerFightData> {
  const fl = fights ?? (await client.fights(report));
  const fight = fl.fights.find((f) => f.id === fightId);
  if (!fight) throw new Error(`Fight ${fightId} not found in report ${report}`);
  const players = fl.friendlies.filter((a) => a.type !== 'Pet' && a.type !== 'NPC' && a.fights.some((f) => f.id === fightId));
  const [s, e] = [fight.start_time, fight.end_time];
  const range = { start: s, end: e };
  // Casts, buffs, mana and combatant info in one request. It also has what those views leave out:
  // pets' casts, players' melee swings and enemies' buffs. Deaths stay apart: only that view tells
  // Feign Death from a real one.
  const [healing, damage, log, deaths, healingDone, meleeTaken, shadowOfDeath] = await Promise.all([
    client.events('healing', report, s, e, {}, FIELDS),
    client.events('damage-taken', report, s, e, {}, FIELDS),
    client.events('summary', report, s, e, { filter: `type in (${[...CAST_TYPES, ...BUFF_TYPES, 'resourcechange', 'combatantinfo'].map((t) => `"${t}"`).join(', ')})` }, [...FIELDS, 'targetIsFriendly']),
    client.events('deaths', report, s, e, {}, FIELDS),
    client.table<{ entries: ActorTableEntry[] }>('healing', report, range),
    client.table<{ entries: ActorTableEntry[] }>('damage-taken', report, { ...range, abilityid: 1 }),
    TERON.has(fight.boss) ? client.events('debuffs', report, s, e, { abilityid: SHADOW_OF_DEATH }, FIELDS) : Promise.resolve([]),
  ]);
  const ids = new Set(players.map((p) => p.id));
  return {
    report,
    fight,
    players,
    healing,
    damage,
    casts: log.filter((x) => CAST_TYPES.includes(x.type) && ids.has(x.sourceID!) && x.ability?.guid !== 1),
    buffs: log.filter((x) => BUFF_TYPES.includes(x.type) && x.targetIsFriendly !== false),
    deaths,
    resources: log.filter((x) => x.type === 'resourcechange'),
    combatants: log.filter((x) => x.type === 'combatantinfo' && x.timestamp <= s + 1000) as unknown as HealerFightData['combatants'],
    healingDone: healingDone.entries,
    meleeTaken: meleeTaken.entries,
    shadowOfDeath,
  };
}
