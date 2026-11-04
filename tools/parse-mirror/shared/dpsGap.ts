// Splits each top player's real DPS difference to you into gear & buffs, kill time, play and luck.
// The sim's numbers are scaled by how much of their simmed DPS the top players turn into luck-free
// real DPS (their median), so an overall sim bias doesn't show up as play. The parts add up exactly.
import type { AbilityPlay, SimPlayerResult } from './types.ts';

export const GAP_PARTS = ['gear', 'kill', 'play', 'luck'] as const;
export type GapPart = (typeof GAP_PARTS)[number];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median of (real − luck) / sim DPS over the top players; 1 when there's nothing to go on. */
export function simScale(rows: SimPlayerResult[]): number {
  const ratios = rows.filter((e) => e.rank && e.simDps > 0).map((e) => (e.actualDps - e.luck.luckDps) / e.simDps);
  return ratios.length ? median(ratios) : 1;
}

export function gapParts(e: SimPlayerResult, you: SimPlayerResult, k: number): Record<GapPart, number> {
  // What's left of real DPS after luck and the scaled sim: how well they played their setup.
  const play = (p: SimPlayerResult) => p.actualDps - p.luck.luckDps - k * p.simDps;
  // Older saved results have no sim on your kill time; then kill time stays inside "gear & buffs".
  const onYourTime = e.simDpsOnYourTime ?? e.simDps;
  return {
    gear: k * (onYourTime - you.simDps),
    kill: k * (e.simDps - onYourTime),
    play: play(e) - play(you),
    luck: e.luck.luckDps - you.luck.luckDps,
  };
}

/** ± ranges are about 95%: 1.96 standard errors. */
export const NOISE_Z = 1.96;

const meanOf = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

export interface GapNoise {
  /** Standard error of each tile (the group average of a part), and its 95% half-width. */
  parts: Record<GapPart, { se: number; half: number }>;
}

/**
 * How sure the tiles are about these players: only what is measured with noise. The group is the
 * comparison, not a sample, so which top players happen to be in it adds nothing. That leaves the
 * sims' own noise (paired by iteration on the server, noise.group on your row; older results get a
 * conservative bound from each player's standard errors) and the noise in the luck estimates.
 */
export function gapNoise(rows: SimPlayerResult[], you: SimPlayerResult): GapNoise {
  const others = rows.filter((e) => e.rank);
  const k = simScale(rows);
  const avgSe = (f: (e: SimPlayerResult) => number | undefined) => meanOf(others.map((e) => f(e) ?? 0));
  const group = you.noise?.group;
  const sim: Record<'gear' | 'kill' | 'play', number> = group
    ? { gear: group.gearSe, kill: group.killSe, play: group.playSe }
    : {
        gear: avgSe((e) => e.noise?.gearSe),
        kill: avgSe((e) => e.noise?.killSe),
        play: avgSe((e) => e.noise?.simSe) + (you.noise?.simSe ?? 0),
      };
  // The group's luck estimates and yours come from separate sims.
  const luckSe = Math.hypot(avgSe((e) => e.luck.estimateSeDps), you.luck.estimateSeDps ?? 0);
  const se: Record<GapPart, number> = { gear: k * sim.gear, kill: k * sim.kill, play: Math.hypot(k * sim.play, luckSe), luck: luckSe };
  return { parts: Object.fromEntries(GAP_PARTS.map((part) => [part, { se: se[part], half: NOISE_Z * se[part] }])) as GapNoise['parts'] };
}

/**
 * One ability in Play by ability: how you used it against the sim of your setup, the same for the
 * group against theirs, and what the difference is worth in DPS.
 */
export interface AbilityGapRow {
  name: string;
  icon?: string;
  byHits?: boolean;
  /**
   * Casts (or hits) as a share of the sim's (1 = as many as the sim), yours and the average of the
   * group players whose sim uses it. Undefined when the sim doesn't cast it.
   */
  castsPct?: number;
  groupCastsPct?: number;
  /** Damage per cast with luck removed as a share of the sim's, yours and the group's average. */
  perCastPct?: number;
  groupPerCastPct?: number;
  /** The group's lowest and highest of each share: what's normal among them. */
  groupCastsRange?: [number, number];
  groupPerCastRange?: [number, number];
  /** The facts behind them: casts per minute (yours, the sim's, the group's median) and damage per cast. */
  perMinute?: number;
  simPerMinute?: number;
  groupPerMinute?: number;
  perCast?: number;
  simPerCast?: number;
  /**
   * Yours: real DPS, the sim's and luck. Luck is its direct crit, miss and resist luck plus its
   * share (by damage) of the knock-on and proc luck.
   */
  realDps: number;
  simDps: number;
  luckDps: number;
  /**
   * Your real − luck − sim on it split in two, against the sim as it is: casting it more or less
   * often, and damage per cast. For the finding's wording.
   */
  castsPart?: number;
  perCastPart?: number;
  /**
   * Play like the tile (real − luck − k × sim), yours and the group's average, and the gap
   * (theirs − yours). The gaps and other's add up to the Play tile.
   */
  play: number;
  groupPlay: number;
  gap: number;
}

/** A share of the sim: yours, the group's average and their lowest and highest. */
export interface SimShare {
  you?: number;
  group?: number;
  range?: [number, number];
}

export interface PlayByAbility {
  /**
   * Over every ability the sim uses: casts as a share of the sim's (weighted by the sim's damage
   * per cast) and damage per cast as a share of the sim's, luck removed. Multiplied, they are real
   * DPS without luck ÷ the sim's on those abilities, so the group's product is close to k.
   */
  overall: { casts: SimShare; perCast: SimShare };
  /** Abilities over the share threshold, biggest gap first. */
  rows: AbilityGapRow[];
  /** Everything else: smaller abilities (named, biggest first) and damage the sim names differently. */
  other: { play: number; groupPlay: number; gap: number; names: string[] };
  /** The Play tile: your play, the group's average and the gap. Rows plus other add up to these. */
  total: { play: number; groupPlay: number; gap: number };
}

const medianOf = (xs: number[]) => (xs.length ? median(xs) : undefined);
/** Average and lowest-to-highest of the defined values. */
function spread(xs: (number | undefined)[]): { group?: number; range?: [number, number] } {
  const ok = xs.filter((x): x is number => x !== undefined);
  return ok.length ? { group: meanOf(ok), range: [Math.min(...ok), Math.max(...ok)] } : {};
}

/**
 * Splits Play (real − luck − k × sim) by ability: play_a = real_a − luck_a − k × sim_a, with the
 * luck that isn't on any one ability (knock-on, procs) shared out by damage. What's left of a
 * player's play after the shown abilities is "other". The gap per ability is the group's average
 * play_a minus yours, like the tiles, so the gaps and other add up to the Play tile exactly.
 * Abilities under `minShare` of your (or the group's typical) DPS go into other.
 *
 * The table explains each gap with shares of the sim, which need no k: casts ÷ the sim's casts and
 * damage per cast ÷ the sim's, yours next to the group's.
 */
export function playByAbility(rows: SimPlayerResult[], you: SimPlayerResult, k: number, minShare = 0.02): PlayByAbility | undefined {
  if (!you.abilities?.length) return undefined;
  const mineAll = you.abilities;
  const others = rows.filter((e) => e.rank);
  const playOf = (p: SimPlayerResult) => p.actualDps - p.luck.luckDps - k * p.simDps;
  // Each ability's luck: its direct luck plus its share of the rest of the player's luck.
  const luckOf = (p: SimPlayerResult, a: AbilityPlay) => {
    const all = p.abilities ?? [];
    const real = all.reduce((s, x) => s + x.realDps, 0);
    const spread = p.luck.luckDps - all.reduce((s, x) => s + x.luckDps, 0);
    return a.luckDps + (real > 0 ? (spread * a.realDps) / real : 0);
  };
  const find = (p: SimPlayerResult, name: string) => p.abilities?.find((x) => x.name === name);
  const abilityPlay = (p: SimPlayerResult, name: string) => {
    const a = find(p, name);
    return a ? a.realDps - luckOf(p, a) - k * a.simDps : 0;
  };
  const castsPct = (a?: AbilityPlay) => (a && a.simCasts > 0 ? a.casts / a.simCasts : undefined);
  const perCastPct = (p: SimPlayerResult, a?: AbilityPlay) =>
    a && a.casts > 0 && a.simCasts > 0 && a.simDps > 0 ? (a.realDps - luckOf(p, a)) / a.casts / (a.simDps / a.simCasts) : undefined;
  const perMinute = (p: SimPlayerResult, casts: number) => (p.durationSec ? casts / (p.durationSec / 60) : undefined);

  const names = new Set([...mineAll.map((a) => a.name), ...others.flatMap((e) => (e.abilities ?? []).map((a) => a.name))]);
  const shown: AbilityGapRow[] = [];
  const hidden: { name: string; dps: number }[] = [];
  for (const name of names) {
    const mine = find(you, name);
    const groupShare = medianOf(others.map((e) => (e.simDps ? (find(e, name)?.simDps ?? 0) / e.simDps : 0))) ?? 0;
    const share = Math.max(mine && you.simDps ? mine.simDps / you.simDps : 0, mine && you.actualDps ? mine.realDps / you.actualDps : 0, groupShare);
    if (share < minShare) {
      const dps = Math.max(mine?.realDps ?? 0, mine?.simDps ?? 0, ...others.map((e) => find(e, name)?.realDps ?? 0));
      if (dps > 0) hidden.push({ name, dps });
      continue;
    }

    const play = abilityPlay(you, name);
    const luck = mine ? luckOf(you, mine) : 0;
    const groupPlay = meanOf(others.map((e) => abilityPlay(e, name)));
    // The group's shares only over players whose sim uses it, with the same kind of count as yours.
    const same = (a?: AbilityPlay): a is AbilityPlay => !!a && !!a.byHits === !!mine?.byHits;
    const theirs = others.map((e) => ({ e, a: find(e, name) }));
    const groupCasts = spread(theirs.map(({ a }) => (same(a) ? castsPct(a) : undefined)));
    const groupPerCast = spread(theirs.map(({ e, a }) => (same(a) ? perCastPct(e, a) : undefined)));
    const icon = mine?.icon ?? theirs.find(({ a }) => a?.icon)?.a?.icon;
    const row: AbilityGapRow = {
      name,
      ...(icon ? { icon } : {}),
      ...(mine?.byHits ? { byHits: true } : {}),
      castsPct: castsPct(mine),
      groupCastsPct: groupCasts.group,
      groupCastsRange: groupCasts.range,
      perCastPct: perCastPct(you, mine),
      groupPerCastPct: groupPerCast.group,
      groupPerCastRange: groupPerCast.range,
      groupPerMinute: medianOf(
        // Only players who used it: a spell only their sim cast says nothing about the pace.
        theirs.flatMap(({ e, a }) => {
          const pm = same(a) && a.casts > 0 ? perMinute(e, a.casts) : undefined;
          return pm === undefined ? [] : [pm];
        }),
      ),
      realDps: mine?.realDps ?? 0,
      simDps: mine?.simDps ?? 0,
      luckDps: luck,
      play,
      groupPlay,
      gap: groupPlay - play,
    };
    if (mine) {
      row.perMinute = perMinute(you, mine.casts);
      if (you.durationSec && mine.casts > 0) row.perCast = ((mine.realDps - luck) * you.durationSec) / mine.casts;
    }
    if (mine && mine.simCasts > 0) {
      // real − sim = (casts − simCasts) × simPerCast + (perCast − simPerCast) × casts, all ÷ kill
      // length. Luck comes off the per-cast side, where it happened.
      const simPerCastDps = mine.simDps / mine.simCasts;
      row.castsPart = (mine.casts - mine.simCasts) * simPerCastDps;
      row.perCastPart = mine.realDps - mine.casts * simPerCastDps - luck;
      row.simPerMinute = perMinute(you, mine.simCasts);
      if (you.durationSec) row.simPerCast = simPerCastDps * you.durationSec;
    } else if (mine && mine.casts > 0 && !mine.byHits) {
      // A spell the sim never casts: all of it comes from casting it.
      row.castsPart = mine.realDps - luck - mine.simDps;
      row.perCastPart = 0;
    }
    shown.push(row);
  }
  shown.sort((a, b) => b.gap - a.gap);

  // Overall shares: C = Σ casts × sim per cast, S = Σ sim, R = Σ (real − luck) over the abilities
  // the sim uses; casts = C ÷ S and per cast = R ÷ C.
  const overallOf = (p: SimPlayerResult) => {
    let c = 0, sim = 0, r = 0;
    for (const a of p.abilities ?? []) {
      if (a.simCasts <= 0 || a.simDps <= 0) continue;
      c += (a.casts * a.simDps) / a.simCasts;
      sim += a.simDps;
      r += a.realDps - luckOf(p, a);
    }
    return { casts: sim > 0 ? c / sim : undefined, perCast: c > 0 ? r / c : undefined };
  };
  const mineOverall = overallOf(you);
  const theirOverall = others.map(overallOf);
  const overall = {
    casts: { you: mineOverall.casts, ...spread(theirOverall.map((o) => o.casts)) },
    perCast: { you: mineOverall.perCast, ...spread(theirOverall.map((o) => o.perCast)) },
  };

  const play = playOf(you);
  const groupPlay = meanOf(others.map(playOf));
  const otherPlay = play - shown.reduce((s, r) => s + r.play, 0);
  const otherGroup = groupPlay - shown.reduce((s, r) => s + r.groupPlay, 0);
  return {
    overall,
    rows: shown,
    other: { play: otherPlay, groupPlay: otherGroup, gap: otherGroup - otherPlay, names: hidden.sort((a, b) => b.dps - a.dps).map((h) => h.name) },
    total: { play, groupPlay, gap: groupPlay - play },
  };
}

/**
 * The ability that costs you most against the group, when it's at least `minShare` of your DPS,
 * and why: fewer casts than your setup allows, less per cast (whichever loses you at least a
 * quarter of the gap, the bigger one first), or else the group got more out of it than their sims.
 */
export function biggestAbilityGap(t: PlayByAbility, you: SimPlayerResult, minShare = 0.03): { row: AbilityGapRow; reason: 'casts' | 'perCast' | 'group' } | undefined {
  const row = t.rows[0];
  if (!row || row.gap < minShare * you.actualDps) return undefined;
  const casts = row.castsPart ?? 0;
  const perCast = row.perCastPart ?? 0;
  const matters = (v: number) => v < -0.25 * row.gap;
  const reason = matters(casts) && casts <= perCast ? 'casts' : matters(perCast) ? 'perCast' : 'group';
  return { row, reason };
}
