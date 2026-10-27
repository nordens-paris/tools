// Healer metrics for one healer in one fight, and the raid's deaths. See model.ts for the log
// facts these rely on. Thresholds were tuned on nine BT/Hyjal kills.
import type { HealerDeath, HealerFightSummary, HealerMetrics, HealerRole, HealerSpellRow, HealerUpkeep } from '../../../shared/types.ts';
import { AUTO_HEALS, DISPELS, HEALER_COOLDOWNS, HOTS } from '../../specs/healers.ts';
import { median } from '../stats.ts';
import { type FightModel, type LogEvent, manaOf } from './model.ts';

/** HP below this counts as "needed healing" for idle time. */
const NEEDED_PCT = 70;
/** A drop below this starts a reaction measurement. */
const REACTION_PCT = 50;
/** A drop below this, pulled back up, is a save. */
const SAVE_PCT = 25;
/** A heal landing this soon after a drop is the same server tick, not a reaction. */
const SAME_TICK_MS = 150;

const isDirectHeal = (e: LogEvent) => e.type === 'heal' && !e.tick && !AUTO_HEALS.has(e.ability?.name ?? '');

export function healerMetrics(m: FightModel, id: number): HealerMetrics {
  const spec = m.healers.get(id);
  if (!spec) throw new Error(`${m.name(id)} isn't one of this fight's healers`);
  const { T0, T1, durationSec: dur } = m;
  const mine = m.healing.filter((e) => e.sourceID === id);
  const mc = m.casts.filter((e) => e.sourceID === id && (e.type === 'cast' || e.type === 'begincast'));
  const effective = mine.reduce((s, e) => s + (e.amount ?? 0), 0);
  const absorbed = mine.filter((e) => e.type === 'absorbed').reduce((s, e) => s + (e.amount ?? 0), 0);
  const overhealTotal = mine.filter((e) => e.type === 'heal').reduce((s, e) => s + (e.overheal ?? 0), 0);

  // Assignment
  const byTarget = new Map<number, number>();
  for (const e of mine) if (e.targetID !== undefined) byTarget.set(e.targetID, (byTarget.get(e.targetID) ?? 0) + (e.amount ?? 0));
  const shareOn = (ids: Iterable<number>) => {
    let s = 0;
    for (const t of ids) s += byTarget.get(t) ?? 0;
    return effective ? s / effective : 0;
  };
  const tankShare = shareOn(m.tanks);
  const role: HealerRole = tankShare >= 0.5 ? 'tank' : tankShare >= 0.25 ? 'mixed' : 'raid';
  const assigned = new Set<number>(
    role === 'tank' ? m.tanks : role === 'raid' ? m.players.keys() : [...m.tanks, ...[...byTarget].filter(([, v]) => v > 0.08 * effective).map(([t]) => t)],
  );
  const topTargets = [...byTarget]
    .filter(([t]) => m.players.has(t))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([t, v]) => ({ name: m.name(t), icon: m.icon(t), share: effective ? v / effective : 0 }));

  // Mana: the healer's own mana rides on their casts and on heals they're the source of.
  const own = [...mc, ...mine]
    .filter((e) => e.resourceActor === 1)
    .map((e) => ({ t: e.timestamp, mana: manaOf(e) }))
    .filter((x): x is { t: number; mana: NonNullable<ReturnType<typeof manaOf>> } => !!x.mana)
    .sort((a, b) => a.t - b.t);
  const manaAt = (t: number) => {
    let v: number | undefined;
    for (const x of own) {
      if (x.t > t) break;
      v = x.mana.current;
    }
    return v ?? own[0]?.mana.current;
  };
  let mana: HealerMetrics['mana'];
  if (own.length) {
    const max = Math.max(...own.map((x) => x.mana.max));
    const spent = mc.filter((e) => e.type === 'cast' && e.resourceActor === 1).reduce((s, e) => s + (manaOf(e)?.cost ?? 0), 0);
    let below10 = 0;
    for (let i = 1; i < own.length; i++) if (own[i - 1].mana.current / max < 0.1) below10 += own[i].t - own[i - 1].t;
    const curve: { t: number; pct: number }[] = [];
    const step = Math.max(2, Math.round(dur / 120));
    for (let s = 0; s <= dur; s += step) curve.push({ t: s, pct: (manaAt(T0 + s * 1000) ?? 0) / max });
    mana = {
      max,
      spent,
      curve,
      lowest: Math.min(...own.map((x) => x.mana.current)) / max,
      end: own[own.length - 1].mana.current / max,
      secBelow10: Math.round(below10 / 1000),
      healPerMana: spent ? effective / spent : 0,
    };
  }
  const manaPctAt = (t: number) => (mana && manaAt(t) !== undefined ? manaAt(t)! / mana.max : undefined);
  const gained = new Map<string, number>();
  let manaWasted = 0;
  for (const e of m.resources) {
    if (e.targetID !== id || e.resourceChangeType !== 0 || !e.ability) continue;
    gained.set(e.ability.name, (gained.get(e.ability.name) ?? 0) + (e.resourceChange ?? 0) - (e.waste ?? 0));
    manaWasted += e.waste ?? 0;
  }

  // Cooldowns used, and the ones others put on the healer.
  const cooldowns: HealerMetrics['cooldowns'] = mc
    .filter((e) => e.type === 'cast' && e.ability && HEALER_COOLDOWNS[e.ability.name])
    .map((e) => ({ name: HEALER_COOLDOWNS[e.ability!.name], icon: e.ability!.abilityIcon, atSec: Math.round((e.timestamp - T0) / 1000), manaPct: manaPctAt(e.timestamp - 1) }));
  for (const e of m.buffs) {
    const n = e.ability?.name;
    if (e.targetID === id && e.type === 'applybuff' && (n === 'Innervate' || n === 'Power Infusion') && e.sourceID !== id) {
      cooldowns.push({ name: n, icon: e.ability!.abilityIcon, atSec: Math.round((e.timestamp - T0) / 1000), manaPct: manaPctAt(e.timestamp), from: m.name(e.sourceID) });
    }
  }
  cooldowns.sort((a, b) => a.atSec - b.atSec);

  // Spells, by name: PoM / Earth Shield / Lifebloom heal under other IDs than the cast.
  const spells = new Map<string, HealerSpellRow & { rankSet: Set<number> }>();
  const spell = (e: LogEvent) => {
    const n = e.ability!.name;
    let r = spells.get(n);
    if (!r) spells.set(n, (r = { name: n, icon: e.ability!.abilityIcon, casts: 0, mana: 0, effective: 0, overheal: 0, hits: 0, rankSet: new Set() }));
    return r;
  };
  for (const e of mc) {
    if (e.type !== 'cast' || !e.ability) continue;
    const r = spell(e);
    r.casts++;
    r.rankSet.add(e.ability.guid);
    if (e.resourceActor === 1) r.mana += manaOf(e)?.cost ?? 0;
  }
  for (const e of mine) {
    if (!e.ability) continue;
    const r = spell(e);
    r.effective += e.amount ?? 0;
    r.overheal += e.overheal ?? 0;
    r.hits++;
  }
  const spellRows = [...spells.values()]
    .filter((r) => r.effective || r.casts)
    .sort((a, b) => b.effective - a.effective || b.casts - a.casts)
    .map(({ rankSet, ...r }) => (rankSet.size > 1 ? { ...r, ranks: [...rankSet].sort((a, b) => a - b) } : r));

  // Cast pairs (cast start -> finished cast), cancels, and tank preheals.
  const begins = mc.filter((e) => e.type === 'begincast');
  const cancels: { lost: number; topped: boolean }[] = [];
  const preheal: number[] = [];
  const reactive: number[] = [];
  let lastDirectTarget: number | undefined;
  let castsClean = 0;
  let castsWithOverheal = 0;
  for (let i = 0; i < mc.length; i++) {
    const e = mc[i];
    if (e.type === 'cast' && e.targetID !== undefined && m.players.has(e.targetID) && !HOTS.has(e.ability?.name ?? '')) lastDirectTarget = e.targetID;
    if (e.type !== 'begincast') continue;
    const next = mc[i + 1];
    if (!next || next.type !== 'cast' || next.ability?.guid !== e.ability?.guid || next.timestamp - e.timestamp > 5000) {
      const end = next ? next.timestamp : e.timestamp + 1500;
      // A cast start has no target; guess the last direct heal's target, and whether it was topped.
      cancels.push({ lost: (end - e.timestamp) / 1000, topped: lastDirectTarget !== undefined && m.hpAt(lastDirectTarget, end) >= 95 });
      continue;
    }
    const tgt = next.targetID;
    if (tgt === undefined || !m.players.has(tgt)) continue;
    const land = mine.find((x) => x.type === 'heal' && !x.tick && x.targetID === tgt && x.timestamp >= next.timestamp && x.timestamp < next.timestamp + 400);
    if (!land) continue;
    const size = (land.amount ?? 0) + (land.overheal ?? 0);
    if (land.overheal) castsWithOverheal++;
    else castsClean++;
    if (m.tanks.includes(tgt) && size) (m.hpAt(tgt, e.timestamp) >= 90 ? preheal : reactive).push((land.amount ?? 0) / size);
  }

  // Overheal by cause. A heal is judged by the gap when the healer committed: cast start for
  // cast-time spells, just before landing for instants.
  let ownChoice = 0;
  let othersFilled = 0;
  let bounces = 0;
  for (const x of mine) {
    if (x.type !== 'heal' || x.tick || !x.overheal || x.targetID === undefined || !m.players.has(x.targetID)) continue;
    const name = x.ability?.name ?? '';
    if (name === 'Prayer of Mending' || name === 'Earth Shield') continue;
    if (name === 'Chain Heal') {
      const c = mc.find((e) => e.type === 'cast' && e.ability?.name === 'Chain Heal' && x.timestamp - e.timestamp >= 0 && x.timestamp - e.timestamp < 1500);
      if (c && c.targetID !== x.targetID) {
        bounces += x.overheal;
        continue;
      }
    }
    let begin: LogEvent | undefined;
    for (let i = begins.length - 1; i >= 0; i--) {
      const b = begins[i];
      if (b.timestamp >= x.timestamp) continue;
      if (b.timestamp < x.timestamp - 4500) break;
      if (b.ability?.guid === x.ability?.guid) {
        begin = b;
        break;
      }
    }
    const tDecide = begin ? begin.timestamp : x.timestamp - 1;
    const gap = ((100 - m.hpAt(x.targetID, tDecide)) / 100) * m.maxHp(x.targetID).value;
    const size = (x.amount ?? 0) + x.overheal;
    const own = Math.min(x.overheal, Math.max(0, size - gap));
    ownChoice += own;
    othersFilled += x.overheal - own;
  }
  const tickOver = mine.reduce((s, e) => s + (e.tick ? (e.overheal ?? 0) : 0), 0);
  const procOver = mine.reduce((s, e) => s + (e.ability?.name === 'Prayer of Mending' || e.ability?.name === 'Earth Shield' ? (e.overheal ?? 0) : 0), 0);
  const ov = overhealTotal || 1;

  // Reaction: assigned targets dropping below 50% -> this healer's first chosen heal on them.
  const direct = m.healing.filter((e) => isDirectHeal(e) && e.sourceID !== undefined && m.players.has(e.sourceID) && (e.amount ?? 0) > 0);
  const rts: number[] = [];
  let drops = 0;
  let first = 0;
  for (const d of m.drops(REACTION_PCT)) {
    if (!assigned.has(d.id) || !m.alive(d.id, d.t)) continue;
    drops++;
    const after = direct.filter((x) => x.targetID === d.id && x.timestamp > d.t + SAME_TICK_MS && x.timestamp < d.t + 6000);
    const mineAfter = after.find((x) => x.sourceID === id);
    if (mineAfter) rts.push((mineAfter.timestamp - d.t) / 1000);
    if (after[0]?.sourceID === id) first++;
  }

  // Saves: someone below 25% pulled back by this healer (a heal or shield of 10%+ of their HP)
  // within 3 s, who then lived 5 s more.
  const savers = m.healing.filter((e) => (isDirectHeal(e) || e.type === 'absorbed') && (e.amount ?? 0) > 0);
  let saves = 0;
  for (const d of m.drops(SAVE_PCT)) {
    if (!m.alive(d.id, d.t + 5000)) continue;
    const big = 0.1 * m.maxHp(d.id).value;
    const h = savers.find((x) => x.targetID === d.id && x.timestamp >= d.t && x.timestamp < d.t + 3000 && (x.amount ?? 0) > big);
    if (h?.sourceID === id) saves++;
  }

  // Activity in 100 ms ticks: cast start to finish, or one GCD for instants.
  const ticks = Math.floor(dur * 10);
  const busy = new Uint8Array(ticks + 1);
  const mark = (from: number, to: number) => {
    for (let k = Math.max(0, Math.floor((from - T0) / 100)); k <= Math.min(ticks, Math.floor((to - T0) / 100)); k++) busy[k] = 1;
  };
  for (let i = 0; i < mc.length; i++) {
    const e = mc[i];
    if (e.type === 'begincast') mark(e.timestamp, mc[i + 1]?.timestamp ?? e.timestamp + 2500);
    else if (!(mc[i - 1]?.type === 'begincast' && mc[i - 1].ability?.guid === e.ability?.guid)) mark(e.timestamp, e.timestamp + 1500);
  }
  let aliveTicks = 0;
  let busyTicks = 0;
  let need = 0;
  let idle = 0;
  const watch = [...assigned].filter((p) => m.hasHp(p));
  for (let k = 0; k < ticks; k++) {
    const t = T0 + k * 100;
    if (!m.alive(id, t)) continue;
    aliveTicks++;
    if (busy[k]) busyTicks++;
    if (watch.some((p) => m.alive(p, t) && m.hpAt(p, t) < NEEDED_PCT)) {
      need++;
      if (!busy[k]) idle++;
    }
  }

  // Upkeep of the spec's buffs/HoTs on others.
  const upkeep: HealerUpkeep[] = [];
  for (const buff of spec.upkeep) {
    const up = new Map<number, number>();
    const open = new Map<number, number>();
    let icon: string | undefined;
    for (const e of m.buffs) {
      if (e.sourceID !== id || e.ability?.name !== buff || e.targetID === undefined) continue;
      icon ??= e.ability.abilityIcon;
      if (e.type === 'applybuff') open.set(e.targetID, e.timestamp);
      else if (e.type === 'removebuff' && open.has(e.targetID)) {
        up.set(e.targetID, (up.get(e.targetID) ?? 0) + e.timestamp - open.get(e.targetID)!);
        open.delete(e.targetID);
      }
    }
    for (const [t, from] of open) up.set(t, (up.get(t) ?? 0) + T1 - from);
    if (!up.size) continue;
    const [main, ms] = [...up].sort((a, b) => b[1] - a[1])[0];
    const row: HealerUpkeep = { name: buff, icon, target: m.name(main), uptime: ms / (T1 - T0), targets: up.size };
    if (buff === 'Lifebloom') row.stack3 = stack3Uptime(m, id, main);
    upkeep.push(row);
  }

  return {
    source: id,
    name: m.name(id),
    icon: spec.icon,
    specLabel: spec.label,
    hps: dur ? effective / dur : 0,
    effective,
    absorbed,
    overhealPct: effective - absorbed + overhealTotal ? overhealTotal / (effective - absorbed + overhealTotal) : 0,
    shareOfRaid: m.raidEffective ? effective / m.raidEffective : 0,
    role,
    tankShare,
    tankShareIcon: shareOn(m.tankSpecs),
    topTargets,
    mana,
    manaGained: [...gained].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    manaWasted,
    cooldowns,
    spells: spellRows,
    overheal: {
      ownChoice: ownChoice / ov,
      othersFilled: othersFilled / ov,
      chainHealBounces: bounces / ov,
      hotTicks: tickOver / ov,
      procHeals: procOver / ov,
    },
    castsClean,
    castsWithOverheal,
    cancels: {
      count: cancels.length,
      started: begins.length,
      secLost: cancels.reduce((s, c) => s + c.lost, 0),
      likelyTopped: cancels.filter((c) => c.topped).length,
    },
    tankPreheal:
      preheal.length || reactive.length
        ? {
            preheals: preheal.length,
            reactive: reactive.length,
            prehealEffective: preheal.length ? preheal.reduce((s, v) => s + v, 0) / preheal.length : undefined,
            reactiveEffective: reactive.length ? reactive.reduce((s, v) => s + v, 0) / reactive.length : undefined,
          }
        : undefined,
    reaction: { drops, answered: rts.length, medianSec: rts.length ? median(rts) : undefined, firstResponder: drops ? first / drops : undefined },
    saves,
    activity: aliveTicks ? busyTicks / aliveTicks : 0,
    idleWhileNeeded: { sec: idle / 10, ofSec: need / 10 },
    upkeep,
    dispels: mc.filter((e) => e.type === 'cast' && DISPELS.has(e.ability?.name ?? '')).length,
    context: { raidHealers: m.healers.size, raidDtps: m.raidDtps, healPerRaidDamage: m.raidDtps * dur ? effective / (m.raidDtps * dur) : 0 },
  };
}

/** Overheal from the healer's own choices, as a share of all healing they put out. */
export const ownOverheal = (h: HealerMetrics) => {
  const direct = h.effective - h.absorbed;
  const over = direct ? (h.overhealPct * direct) / (1 - h.overhealPct || 1) : 0;
  return direct + over ? (h.overheal.ownChoice * over) / (direct + over) : 0;
};

/** Share of the fight a healer's Lifebloom sat at 3 stacks on one target. */
function stack3Uptime(m: FightModel, id: number, target: number) {
  let stacks = 0;
  let since: number | undefined;
  let total = 0;
  for (const e of m.buffs) {
    if (e.sourceID !== id || e.targetID !== target || e.ability?.name !== 'Lifebloom') continue;
    if (e.type === 'applybuff') stacks = 1;
    else if (e.type === 'applybuffstack') stacks = e.stack ?? stacks + 1;
    else if (e.type === 'removebuffstack') stacks = e.stack ?? stacks - 1;
    else if (e.type === 'removebuff') stacks = 0;
    if (stacks >= 3 && since === undefined) since = e.timestamp;
    if (stacks < 3 && since !== undefined) {
      total += e.timestamp - since;
      since = undefined;
    }
  }
  if (since !== undefined) total += m.T1 - since;
  return total / (m.T1 - m.T0);
}

/** Each death: how it happened, whether there was time to save them, and what the healers did. */
export function healerDeaths(m: FightModel): HealerDeath[] {
  // Boss abilities on a timer: group hits within 1.5 s, check the spacing is regular.
  const hits = new Map<string, number[]>();
  for (const e of m.damage) {
    // Melee swings are regular by nature (and not always ability 1), so they never count.
    if (e.targetID === undefined || !m.players.has(e.targetID) || e.sourceIsFriendly || e.tick || !e.ability || e.ability.name === 'Melee') continue;
    const ts = hits.get(e.ability.name) ?? [];
    if (!ts.length || e.timestamp - ts[ts.length - 1] > 1500) ts.push(e.timestamp);
    hits.set(e.ability.name, ts);
  }
  const periodic = (name: string) => {
    const ts = hits.get(name) ?? [];
    if (ts.length < 3) return undefined;
    const iv = ts.slice(1).map((t, i) => t - ts[i]);
    const mean = iv.reduce((s, v) => s + v, 0) / iv.length;
    const sd = Math.sqrt(iv.reduce((s, v) => s + (v - mean) ** 2, 0) / iv.length);
    return mean && sd / mean < 0.3 ? Math.round(mean / 100) / 10 : undefined;
  };

  return m.deaths().map(({ id, t }) => {
    const last = [...m.damage].reverse().find((e) => e.targetID === id && e.timestamp <= t + 50);
    const before = m.hpAt(id, (last?.timestamp ?? t) - 1);
    const points = m.hpPoints(id, t - 8000, t);
    // Time from the first reading under 50% (after the last one at 50%+) to the death; 0 when
    // the killing blow came straight from 50%+.
    let secBelow50: number | undefined;
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i][1] >= 50) {
        const firstBelow = points.slice(i + 1).find((p) => p[1] < 50 && p[0] < t);
        secBelow50 = firstBelow ? (t - firstBelow[0]) / 1000 : 0;
        break;
      }
    }
    const kind: HealerDeath['kind'] = before >= 60 && (secBelow50 ?? 0) < 1.5 ? 'burst' : (secBelow50 ?? 0) < 2 ? 'fast' : 'window';
    const dmg = new Map<string, number>();
    for (const e of m.damage) {
      if (e.targetID === id && e.timestamp >= t - 5000 && e.timestamp <= t && e.ability) {
        dmg.set(e.ability.name, (dmg.get(e.ability.name) ?? 0) + (e.amount ?? 0) + (e.absorbed ?? 0));
      }
    }
    const from = t - (secBelow50 ?? 2) * 1000 - 500;
    const killedBy = last?.ability?.name ?? 'Unknown';
    return {
      player: m.name(id),
      icon: m.icon(id),
      atSec: Math.round((t - m.T0) / 1000),
      killedBy,
      kind,
      secBelow50,
      periodicSec: periodic(killedBy),
      damage5s: [...dmg].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 3),
      hp: points.slice(-6).map(([pt, v]) => [Math.round((pt - t) / 100) / 10, v] as [number, number]),
      healers: [...m.healers.keys()].map((h) => ({
        name: m.name(h),
        casts: m.casts
          .filter((e) => e.sourceID === h && e.type === 'cast' && e.timestamp >= from && e.timestamp <= t)
          .slice(-3)
          .map((e) => `${e.ability?.name ?? '?'} → ${m.name(e.targetID)}`),
      })),
    };
  });
}

/** Every healer's metrics and the deaths for one fight. */
export function healerFightSummary(m: FightModel): HealerFightSummary {
  return {
    fight: m.data.fight.id,
    encounter: { id: m.data.fight.boss, name: m.data.fight.name },
    durationSec: m.durationSec,
    tanks: m.tanks.map((t) => ({ name: m.name(t), icon: m.icon(t) })),
    raid: { effective: m.raidEffective, hps: m.durationSec ? m.raidEffective / m.durationSec : 0, dtps: m.raidDtps, healers: m.healers.size },
    healers: [...m.healers.keys()].map((h) => healerMetrics(m, h)),
    deaths: healerDeaths(m),
  };
}
