// What a tank analysis needs from one fight: the raid-wide data the healer analysis also uses
// (who the boss swung at, every hit's outcome, casts, deaths, combatant info; ~10 requests, shared
// through the cache), plus three requests for the tank: their damage done (threat), their buffs
// with up/down times (active mitigation) and the debuffs they kept on the boss.
import { TANK_ICONS } from '../../specs/tanks.ts';
import type { WclReader } from '../../wcl/reader.ts';
import type { WclActor, WclEvent, WclFightsResponse, WclTableAuras } from '../../wcl/types.ts';
import { type ActorTableEntry, FIELDS, fetchHealerFight, type HealerFightData } from '../healer/data.ts';

export interface TankFightData {
  raid: HealerFightData;
  tank: WclActor;
  /** Enemies in the fight; bosses first. */
  enemies: (WclActor & { boss: boolean })[];
  /** The tank's damage done, for threat. */
  done: WclEvent[];
  /** The tank's buffs with bands (when each was up). */
  buffs: WclTableAuras;
  /** Debuffs the tank kept on enemies, with bands. */
  bossDebuffs: WclTableAuras;
  /**
   * A peer's fight, fetched without the raid-wide events: their share of the boss's melee comes
   * from the melee-taken table instead, and who else the boss hit isn't known.
   */
  lite?: { swingShare: number };
}

export async function fetchTankFight(client: WclReader, report: string, fightId: number, source: number, fights?: WclFightsResponse): Promise<TankFightData> {
  const fl = fights ?? (await client.fights(report));
  const fight = fl.fights.find((f) => f.id === fightId);
  if (!fight) throw new Error(`Fight ${fightId} not found in report ${report}`);
  const tank = fl.friendlies.find((a) => a.id === source);
  if (!tank) throw new Error(`Player ${source} not found in report ${report}`);
  const [s, e] = [fight.start_time, fight.end_time];
  const [raid, done, buffs, bossDebuffs] = await Promise.all([
    fetchHealerFight(client, report, fightId, fl),
    client.events('damage-done', report, s, e, { sourceid: source }, FIELDS),
    client.buffs(report, s, e, source),
    client.bossDebuffs(report, s, e, tank.name),
  ]);
  const enemies = (fl.enemies ?? [])
    .filter((a) => a.fights.some((f) => f.id === fightId))
    .map((a) => ({ ...a, boss: a.type === 'Boss' }))
    .sort((a, b) => Number(b.boss) - Number(a.boss));
  return { raid, tank, enemies, done, buffs, bossDebuffs };
}

/**
 * A peer tank's fight, about 8 requests: only their own damage taken, damage done, casts, buffs
 * and debuffs, plus deaths and combatant info (no raid-wide healing or buffs).
 */
export async function fetchTankFightLite(client: WclReader, report: string, fightId: number, name: string): Promise<TankFightData> {
  const fl = await client.fights(report);
  const fight = fl.fights.find((f) => f.id === fightId);
  if (!fight) throw new Error(`Fight ${fightId} not found in report ${report}`);
  const tank = fl.friendlies.find((a) => a.name === name && a.fights.some((f) => f.id === fightId));
  if (!tank) throw new Error(`${name} not found in report ${report}`);
  const [s, e] = [fight.start_time, fight.end_time];
  const range = { start: s, end: e };
  const [taken, done, casts, deaths, combatants, buffs, bossDebuffs, melee] = await Promise.all([
    client.events('damage-taken', report, s, e, { sourceid: tank.id }, FIELDS),
    client.events('damage-done', report, s, e, { sourceid: tank.id }, FIELDS),
    client.events('casts', report, s, e, { sourceid: tank.id }, FIELDS),
    client.events('deaths', report, s, e, {}, FIELDS),
    client.combatantInfos(report, s, e),
    client.buffs(report, s, e, tank.id),
    client.bossDebuffs(report, s, e, tank.name),
    client.table<{ entries: (ActorTableEntry & { sources?: { name: string; total: number; type: string }[] })[] }>('damage-taken', report, { ...range, abilityid: 1 }),
  ]);
  const players = fl.friendlies.filter((a) => a.type !== 'Pet' && a.type !== 'NPC' && a.fights.some((f) => f.id === fightId));
  const raid: HealerFightData = {
    report,
    fight,
    players,
    healing: [],
    damage: taken,
    casts,
    buffs: [],
    deaths,
    resources: [],
    combatants,
    healingDone: [],
    meleeTaken: melee.entries,
  };
  const enemies = (fl.enemies ?? [])
    .filter((a) => a.fights.some((f) => f.id === fightId))
    .map((a) => ({ ...a, boss: a.type === 'Boss' }))
    .sort((a, b) => Number(b.boss) - Number(a.boss));
  return { raid, tank, enemies, done, buffs, bossDebuffs, lite: { swingShare: bossMeleeShare(melee.entries, tank.id) } };
}

/** A player's share of the boss's melee damage on players, from the melee-taken table. */
export function bossMeleeShare(entries: (ActorTableEntry & { sources?: { total: number; type: string }[] })[], id: number) {
  const fromBoss = (e: (typeof entries)[number]) => (e.sources ?? []).filter((s) => s.type === 'Boss').reduce((sum, s) => sum + s.total, 0);
  const total = entries.reduce((sum, e) => sum + fromBoss(e), 0);
  const mine = entries.find((e) => e.id === id);
  return total && mine ? fromBoss(mine) / total : 0;
}

/**
 * Whether a player tanked a fight: a tank-spec icon in the melee-taken table (it carries the spec
 * more often than the fight list), or a warrior, druid or paladin who took a fifth of the melee.
 * One request, shared with the healer and tank fetches.
 */
export async function isTanking(client: WclReader, report: string, fightId: number, source: number, fights?: WclFightsResponse) {
  const fl = fights ?? (await client.fights(report));
  const fight = fl.fights.find((f) => f.id === fightId);
  if (!fight) return false;
  const melee = await client.table<{ entries: ActorTableEntry[] }>('damage-taken', report, { start: fight.start_time, end: fight.end_time, abilityid: 1 });
  const me = melee.entries.find((e) => e.id === source);
  if (!me) return false;
  if (TANK_ICONS.has(me.icon)) return true;
  const total = melee.entries.reduce((s, e) => s + e.total, 0) || 1;
  return ['Warrior', 'Druid', 'Paladin'].includes(me.icon) && me.total > 0.2 * total;
}
