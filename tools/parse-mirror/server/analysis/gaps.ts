// Which idle gaps the comparison group had too (boss mechanics, movement) and which only you had.
// Pure: no Warcraft Logs calls, so it's tested on synthetic players.
import type { GapAlignment, IdleGap, IdleShare } from '../../shared/types.ts';

/** The boss's health from a player's own hits: one point per second, `pct` 0..100. */
export interface BossHpPoint {
  t: number;
  /** "npc:22856" (the NPC's game ID, the same in every log language), or the name without one. */
  boss: string;
  pct: number;
}

export interface GapPlayer {
  durationSec: number;
  /** Every idle gap (not just the 25 longest kept for the browser). */
  gaps: { start: number; duration: number }[];
  bossHp?: BossHpPoint[];
}

/** How far around a gap another player's gap still counts as the same one. */
const HP_SLACK_PCT = 2;
const TIME_SLACK_SEC = 2;
/** HP alignment needs this many players with boss health in their hits. */
const MIN_HP_PLAYERS = 3;

/** Last point at or before t (the boss's health when the gap began). */
function before(hp: BossHpPoint[], t: number): BossHpPoint | undefined {
  let found: BossHpPoint | undefined;
  for (const p of hp) {
    if (p.t > t) break;
    found = p;
  }
  return found;
}

/** First point at or after t (the boss's health when the player hit it again). */
function after(hp: BossHpPoint[], t: number): BossHpPoint | undefined {
  return hp.find((p) => p.t >= t);
}

/** The boss health a gap spans: from the hit before it to the hit after it. */
export function gapHp(hp: BossHpPoint[] | undefined, gap: { start: number; duration: number }): { start?: BossHpPoint; end?: BossHpPoint } {
  if (!hp?.length) return {};
  return { start: before(hp, gap.start) ?? after(hp, gap.start), end: after(hp, gap.start + gap.duration) ?? before(hp, gap.start + gap.duration) };
}

type Span = { boss: string; lo: number; hi: number };

/**
 * A gap as health ranges per boss. Within one boss it's [health after, health before]. Across a
 * boss change (one essence dies, the next one comes) it's the end of the first and the start of the
 * second.
 */
function hpSpans(hp: BossHpPoint[] | undefined, gap: { start: number; duration: number }): Span[] {
  const { start, end } = gapHp(hp, gap);
  if (!start || !end) return [];
  if (start.boss === end.boss) return [{ boss: start.boss, lo: Math.min(start.pct, end.pct), hi: Math.max(start.pct, end.pct) }];
  return [
    { boss: start.boss, lo: 0, hi: start.pct },
    { boss: end.boss, lo: end.pct, hi: 100 },
  ];
}

const spansOverlap = (a: Span[], b: Span[]) =>
  a.some((x) => b.some((y) => x.boss === y.boss && x.lo - HP_SLACK_PCT <= y.hi && y.lo - HP_SLACK_PCT <= x.hi));

const hasHp = (p: GapPlayer) => (p.bossHp?.length ?? 0) > 0;

/** How many of `others` had a gap at the same point of the fight as `gap` of `p`. */
function sharedBy(p: GapPlayer, gap: { start: number; duration: number }, others: GapPlayer[], align: GapAlignment): number {
  if (align === 'time') {
    const lo = gap.start - TIME_SLACK_SEC;
    const hi = gap.start + gap.duration + TIME_SLACK_SEC;
    return others.filter((o) => o.gaps.some((g) => g.start <= hi && g.start + g.duration >= lo)).length;
  }
  const mine = hpSpans(p.bossHp, gap);
  if (!mine.length) return 0;
  return others.filter((o) => o.gaps.some((g) => spansOverlap(mine, hpSpans(o.bossHp, g)))).length;
}

/** The players a gap is compared with: for HP alignment, only those with boss health. */
const comparable = (others: GapPlayer[], align: GapAlignment) => (align === 'hp' ? others.filter(hasHp) : others);

/** Shared = at least half of the players compared with had a gap there too. */
export const isShared = (sharedBy: number, compared: number) => compared > 0 && sharedBy >= Math.ceil(compared / 2);

/** Share of a player's gap time that at least half of the others had too. */
function sharedShare(p: GapPlayer, others: GapPlayer[], align: GapAlignment): number | undefined {
  const pool = comparable(others, align);
  const total = p.gaps.reduce((s, g) => s + g.duration, 0);
  if (!pool.length || !total || (align === 'hp' && !hasHp(p))) return undefined;
  return p.gaps.filter((g) => isShared(sharedBy(p, g, pool, align), pool.length)).reduce((s, g) => s + g.duration, 0) / total;
}

/**
 * Boss health or the clock, whichever lines up more of the group's gaps with each other. Phases and
 * most mechanics happen at the same boss health; some (Supremus' phase swaps, Air Burst) are on a
 * timer. It's measured on the group only, so it doesn't lean towards excusing your gaps.
 */
export function chooseAlignment(group: GapPlayer[]): GapAlignment {
  if (group.filter(hasHp).length < MIN_HP_PLAYERS) return 'time';
  const score = (align: GapAlignment) => {
    const shares = group.map((p, i) => sharedShare(p, group.filter((_, j) => j !== i), align)).filter((s): s is number => s !== undefined);
    return shares.length ? shares.reduce((s, x) => s + x, 0) / shares.length : 0;
  };
  return score('hp') >= score('time') ? 'hp' : 'time';
}

export interface SharedGaps {
  align: GapAlignment;
  compared: number;
  /** Every gap of the player, with how many of the others had one there. */
  gaps: IdleGap[];
  sharedSec: number;
  /** Gap time most of the others didn't have. */
  avoidableSec: number;
}

/** Marks each of a player's gaps as shared or not against the others. */
export function shareGaps(p: GapPlayer, others: GapPlayer[], align: GapAlignment): SharedGaps {
  // Without boss health in your own hits there's nothing to line up by health.
  const useAlign: GapAlignment = align === 'hp' && !hasHp(p) ? 'time' : align;
  const pool = comparable(others, useAlign);
  let sharedSec = 0;
  let avoidableSec = 0;
  const gaps = p.gaps.map((g): IdleGap => {
    const n = sharedBy(p, g, pool, useAlign);
    if (isShared(n, pool.length)) sharedSec += g.duration;
    else avoidableSec += g.duration;
    const { start, end } = gapHp(p.bossHp, g);
    return {
      ...g,
      sharedBy: n,
      ...(start ? { bossHpStart: Math.round(start.pct * 10) / 10 } : {}),
      ...(end ? { bossHpEnd: Math.round(end.pct * 10) / 10 } : {}),
    };
  });
  return { align: useAlign, compared: pool.length, gaps, sharedSec: round1(sharedSec), avoidableSec: round1(avoidableSec) };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * The boss's health over a fight from a player's damage events: the target's health after each hit
 * (`resourceActor === 2`), one point per second. `hitPoints` is a percent on some logs and absolute
 * on others: with `maxHitPoints` it's a ratio, without it absolute values (over 100) are scaled by
 * the most seen on that boss.
 */
export function bossHpTimeline(
  events: { timestamp: number; type?: string; targetID?: number; resourceActor?: unknown; hitPoints?: unknown; maxHitPoints?: unknown }[],
  bossNames: Map<number, string>,
  fightStartMs: number,
): BossHpPoint[] {
  const hits = events.filter(
    (e) => e.type === 'damage' && e.resourceActor === 2 && typeof e.hitPoints === 'number' && e.targetID !== undefined && bossNames.has(e.targetID),
  );
  const maxSeen = new Map<number, number>();
  for (const e of hits) maxSeen.set(e.targetID!, Math.max(maxSeen.get(e.targetID!) ?? 0, e.hitPoints as number));
  const bySecond = new Map<number, BossHpPoint>();
  for (const e of hits.sort((a, b) => a.timestamp - b.timestamp)) {
    const hp = e.hitPoints as number;
    const max = typeof e.maxHitPoints === 'number' && e.maxHitPoints > 0 ? e.maxHitPoints : maxSeen.get(e.targetID!)! > 100 ? maxSeen.get(e.targetID!)! : 100;
    const t = (e.timestamp - fightStartMs) / 1000;
    // The last hit in each second stands for it.
    bySecond.set(Math.floor(t), { t: Math.round(t * 10) / 10, boss: bossNames.get(e.targetID!)!, pct: Math.min(100, Math.max(0, (hp / max) * 100)) });
  }
  return [...bySecond.values()].sort((a, b) => a.t - b.t);
}

/** What `markSharedGaps` needs of a collected player (PlayerFightRaw has it). */
export interface CollectedGaps {
  fight: { durationSec: number; dps: number; idleSec: number; gaps: IdleGap[]; idleShare?: IdleShare };
  allGaps: { start: number; duration: number }[];
  bossHp?: BossHpPoint[];
}

const asGapPlayer = (p: CollectedGaps): GapPlayer => ({ durationSec: p.fight.durationSec, gaps: p.allGaps, bossHp: p.bossHp });

/**
 * Marks every player's gaps as shared or not: yours against the whole group, each top player's
 * against the rest of the group. Sets `gaps[].sharedBy`, the boss health at each gap, and
 * `idleShare`. Casters also get the avoidable time's cost: the seconds times the DPS while casting.
 */
export function markSharedGaps(you: CollectedGaps, top: CollectedGaps[], caster: boolean): void {
  if (!top.length) return;
  const group = top.map(asGapPlayer);
  const align = chooseAlignment(group);
  const mark = (p: CollectedGaps, others: GapPlayer[]) => {
    const r = shareGaps(asGapPlayer(p), others, align);
    const byStart = new Map(r.gaps.map((g) => [g.start, g]));
    p.fight.gaps = p.fight.gaps.map((g) => byStart.get(g.start) ?? g);
    const busySec = p.fight.durationSec - p.fight.idleSec;
    p.fight.idleShare = {
      align: r.align,
      compared: r.compared,
      sharedSec: r.sharedSec,
      avoidableSec: r.avoidableSec,
      // Melee and hunters keep auto-attacking through a gap, so only casters lose everything.
      ...(caster && busySec > 0 ? { avoidableDps: Math.round(((r.avoidableSec * p.fight.dps) / busySec) * 10) / 10 } : {}),
    };
  };
  mark(you, group);
  top.forEach((p, i) => mark(p, group.filter((_, j) => j !== i)));
}
