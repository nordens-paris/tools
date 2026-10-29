// Everything a healer analysis needs from one fight, raid-wide, so a single fetch covers every
// healer in the raid. About 10 requests, more on long fights (each request returns up to 10,000
// events, and the rest is fetched page by page). Report data is cached forever, so a second healer
// from the same raid costs nothing.
import type { WclClient } from '../../wcl/client.ts';
import type { WclActor, WclCombatantInfo, WclEvent, WclFight, WclFightsResponse } from '../../wcl/types.ts';

/** What fetching a fight needs from a client: the server's, or the browser's (web/src/wclBrowser.ts). */
export type HealerDataClient = Pick<WclClient, 'fights' | 'events' | 'combatantInfos' | 'table'>;

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
}

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
export async function fetchHealerFight(client: HealerDataClient, report: string, fightId: number, fights?: WclFightsResponse): Promise<HealerFightData> {
  const fl = fights ?? (await client.fights(report));
  const fight = fl.fights.find((f) => f.id === fightId);
  if (!fight) throw new Error(`Fight ${fightId} not found in report ${report}`);
  const players = fl.friendlies.filter((a) => a.type !== 'Pet' && a.type !== 'NPC' && a.fights.some((f) => f.id === fightId));
  const [s, e] = [fight.start_time, fight.end_time];
  const range = { start: s, end: e };
  const [healing, damage, casts, buffs, deaths, resources, combatants, healingDone, meleeTaken] = await Promise.all([
    client.events('healing', report, s, e, {}, FIELDS),
    client.events('damage-taken', report, s, e, {}, FIELDS),
    client.events('casts', report, s, e, {}, FIELDS),
    client.events('buffs', report, s, e, {}, FIELDS),
    client.events('deaths', report, s, e, {}, FIELDS),
    client.events('summary', report, s, e, { filter: 'type="resourcechange"' }, FIELDS),
    client.combatantInfos(report, s, e),
    client.table<{ entries: ActorTableEntry[] }>('healing', report, range),
    client.table<{ entries: ActorTableEntry[] }>('damage-taken', report, { ...range, abilityid: 1 }),
  ]);
  return {
    report,
    fight,
    players,
    healing,
    damage,
    casts,
    buffs,
    deaths,
    resources,
    combatants,
    healingDone: healingDone.entries,
    meleeTaken: meleeTaken.entries,
  };
}
