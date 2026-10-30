// The shared view of one fight for the healer metrics: who the tanks and healers are, every
// player's HP over time, max HP, deaths, and mana read from the log.
//
// Log facts this relies on (TBC Anniversary):
// - hitPoints/maxHitPoints on events are a PERCENT (0-100), for the actor named by resourceActor
//   (1 = source, 2 = target). Absolute HP needs a max-HP estimate.
// - classResources comes in two layouts: amount/max/type 0/cost (most logs), or shifted one field
//   (amount = max mana, max = cost, type = current mana) in some loggers' logs, our guild's included.
// - Hunter Feign Death is logged as a death at full HP.
import { TANK_ICON, healerSpecFor, type HealerSpec } from '../../specs/healers.ts';
import type { WclActor, WclEvent } from '../../wcl/types.ts';
import { median } from '../stats.ts';
import type { HealerFightData } from './data.ts';

export interface LogEvent extends WclEvent {
  amount?: number;
  overheal?: number;
  absorbed?: number;
  tick?: boolean;
  hitPoints?: number;
  resourceActor?: number;
  classResources?: { amount?: number; max?: number; type?: number; cost?: number }[];
  sourceIsFriendly?: boolean;
  stack?: number;
  resourceChange?: number;
  resourceChangeType?: number;
  waste?: number;
  hitType?: number;
  unmitigatedAmount?: number;
  blocked?: number;
  armor?: number;
}

export interface Mana {
  current: number;
  max: number;
  cost: number;
}

/** Reads the healer's own mana from an event's classResources, in either layout. */
export function manaOf(e: LogEvent): Mana | undefined {
  const c = e.classResources?.[0];
  if (!c) return undefined;
  // Normal layout has type 0 (mana) and max >= amount. Shifted: current mana sits in `type`.
  if (c.type === 0 && (c.max ?? 0) >= (c.amount ?? 0)) return { current: c.amount ?? 0, max: c.max ?? 0, cost: c.cost ?? 0 };
  if (c.type === undefined || !c.amount) return undefined;
  return { current: c.type, max: c.amount, cost: c.max ?? 0 };
}

/** A sorted series of (time, value) with "value at time t" lookups. */
class Series {
  readonly t: number[] = [];
  readonly v: number[] = [];
  push(t: number, v: number) {
    this.t.push(t);
    this.v.push(v);
  }
  /** Last value at or before `time`, else `fallback`. */
  at(time: number, fallback: number) {
    let lo = 0;
    let hi = this.t.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.t[mid] <= time) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found >= 0 ? this.v[found] : fallback;
  }
}

export class FightModel {
  readonly T0: number;
  readonly T1: number;
  readonly durationSec: number;
  readonly players = new Map<number, WclActor>();
  readonly healing: LogEvent[];
  readonly damage: LogEvent[];
  readonly casts: LogEvent[];
  readonly buffs: LogEvent[];
  readonly resources: LogEvent[];
  /** Spec icon per player: table icons first, they carry the spec more often. */
  readonly icons = new Map<number, string>();
  readonly tanks: number[];
  /** Tank-spec players only (the definition peers are picked by). */
  readonly tankSpecs = new Set<number>();
  readonly healers = new Map<number, HealerSpec>();
  /**
   * Players in a heal spec who did under 5% of the raid's healing: not counted as the raid's
   * healers (for context, peers and the reference pool), but analysed when asked about, and checked
   * for holding back (shared/healerScore.ts heldBack).
   */
  readonly minorHealers = new Map<number, HealerSpec>();
  readonly effectiveBySource = new Map<number, number>();
  readonly raidEffective: number;
  readonly raidDtps: number;
  private readonly hp = new Map<number, Series>();
  private readonly deathTimes = new Map<number, number[]>();
  private readonly maxHpCache = new Map<number, { value: number; from: 'damage' | 'stamina' }>();
  private readonly stamina = new Map<number, number>();

  constructor(readonly data: HealerFightData) {
    this.T0 = data.fight.start_time;
    this.T1 = data.fight.end_time;
    this.durationSec = (this.T1 - this.T0) / 1000;
    for (const p of data.players) {
      this.players.set(p.id, p);
      this.icons.set(p.id, p.icon);
    }
    for (const e of [...data.meleeTaken, ...data.healingDone]) if (this.players.has(e.id) && e.icon.includes('-')) this.icons.set(e.id, e.icon);
    const byTime = (a: WclEvent, b: WclEvent) => a.timestamp - b.timestamp;
    this.healing = (data.healing as LogEvent[]).slice().sort(byTime);
    this.damage = (data.damage as LogEvent[]).slice().sort(byTime);
    this.casts = (data.casts as LogEvent[]).slice().sort(byTime);
    this.buffs = (data.buffs as LogEvent[]).slice().sort(byTime);
    this.resources = data.resources as LogEvent[];
    for (const c of data.combatants) this.stamina.set(c.sourceID, Number((c as unknown as { stamina?: number }).stamina) || 0);

    // HP timelines from every event that carries an actor's HP.
    for (const e of [...this.healing, ...this.damage, ...this.casts].sort(byTime)) {
      if (e.resourceActor === undefined || e.hitPoints === undefined) continue;
      const who = e.resourceActor === 1 ? e.sourceID : e.targetID;
      if (who === undefined || !this.players.has(who)) continue;
      let s = this.hp.get(who);
      if (!s) this.hp.set(who, (s = new Series()));
      s.push(e.timestamp, e.hitPoints);
    }
    for (const e of data.deaths) {
      const who = e.targetID;
      if (who === undefined || !this.players.has(who) || this.hpAt(who, e.timestamp - 1) >= 100) continue; // Feign Death
      this.deathTimes.set(who, [...(this.deathTimes.get(who) ?? []), e.timestamp]);
    }

    // Tanks: tank specs with a real share of the boss's melee, or anyone tanking a lot of it
    // (Bloodboil's Fel Rage target).
    const meleeTotal = data.meleeTaken.reduce((s, e) => s + e.total, 0) || 1;
    this.tanks = data.meleeTaken
      .filter((e) => this.players.has(e.id) && ((TANK_ICON.test(e.icon) && e.total > 0.05 * meleeTotal) || e.total > 0.2 * meleeTotal))
      .map((e) => e.id);
    for (const [id, icon] of this.icons) if (TANK_ICON.test(icon)) this.tankSpecs.add(id);

    // Healers: a heal spec (by icon, or by the heals cast) and at least 5% of the raid's healing.
    const spells = new Map<number, Set<string>>();
    for (const e of this.healing) {
      if (e.sourceID === undefined || !this.players.has(e.sourceID)) continue;
      this.effectiveBySource.set(e.sourceID, (this.effectiveBySource.get(e.sourceID) ?? 0) + (e.amount ?? 0));
      if (!spells.has(e.sourceID)) spells.set(e.sourceID, new Set());
      if (e.ability) spells.get(e.sourceID)!.add(e.ability.name);
    }
    this.raidEffective = [...this.effectiveBySource.values()].reduce((s, v) => s + v, 0);
    for (const [id, eff] of this.effectiveBySource) {
      const spec = healerSpecFor(this.icons.get(id) ?? '', spells.get(id));
      if (spec && eff > 0.05 * this.raidEffective) this.healers.set(id, spec);
      else if (spec) this.minorHealers.set(id, spec);
    }
    // In a heal spec by icon but no healing at all.
    for (const [id, icon] of this.icons) {
      const spec = !this.effectiveBySource.has(id) && healerSpecFor(icon);
      if (spec) this.minorHealers.set(id, spec);
    }
    const taken = this.damage.reduce((s, e) => s + (e.targetID !== undefined && this.players.has(e.targetID) ? (e.amount ?? 0) : 0), 0);
    this.raidDtps = this.durationSec ? taken / this.durationSec : 0;
  }

  name(id: number | undefined) {
    return (id !== undefined && this.players.get(id)?.name) || String(id);
  }

  icon(id: number) {
    return this.icons.get(id) ?? this.players.get(id)?.icon ?? '';
  }

  /** HP percent at a time (100 before anything is known). */
  hpAt(id: number, t: number) {
    return this.hp.get(id)?.at(t, 100) ?? 100;
  }

  hasHp(id: number) {
    return this.hp.has(id);
  }

  /** The (time, pct) points of a player's HP between two times. */
  hpPoints(id: number, from: number, to: number): [number, number][] {
    const s = this.hp.get(id);
    if (!s) return [];
    const out: [number, number][] = [];
    for (let i = 0; i < s.t.length; i++) if (s.t[i] >= from && s.t[i] <= to) out.push([s.t[i], s.v[i]]);
    return out;
  }

  /** Times a player's HP crossed from at/above `pct` to below it. */
  drops(pct: number): { t: number; id: number }[] {
    const out: { t: number; id: number }[] = [];
    for (const [id, s] of this.hp) {
      for (let i = 1; i < s.t.length; i++) if (s.v[i - 1] >= pct && s.v[i] < pct) out.push({ t: s.t[i], id });
    }
    return out.sort((a, b) => a.t - b.t);
  }

  deaths(): { id: number; t: number }[] {
    return [...this.deathTimes].flatMap(([id, ts]) => ts.map((t) => ({ id, t }))).sort((a, b) => a.t - b.t);
  }

  /** Alive at time t (no battle-res handling: a death ends the fight for that player). */
  alive(id: number, t: number) {
    return !(this.deathTimes.get(id) ?? []).some((d) => d <= t);
  }

  /** Max HP: from big hits and the HP percent they took off, else from stamina (~7% off). */
  /** `skip`: hits to leave out (a tank's hits under a big temporary buff); not cached. */
  maxHp(id: number, skip?: (e: LogEvent) => boolean) {
    let m = skip ? undefined : this.maxHpCache.get(id);
    if (m) return m;
    const ests: number[] = [];
    for (const e of this.damage) {
      if (e.targetID !== id || e.resourceActor !== 2 || e.hitPoints === undefined || (e.amount ?? 0) <= 1200 || skip?.(e)) continue;
      const drop = this.hpAt(id, e.timestamp - 1) - e.hitPoints;
      if (drop >= 8) ests.push(((e.amount ?? 0) * 100) / drop);
    }
    m = ests.length >= 3 ? { value: median(ests), from: 'damage' } : { value: (this.stamina.get(id) || 600) * 10 + 4000, from: 'stamina' };
    if (!skip) this.maxHpCache.set(id, m);
    return m;
  }
}
