// Healer score: how a healer heals compared with healers of the same spec in the same situation.
// The habits that are a stable trait of the healer (healing per mana, overheal by their own choice,
// idle while someone is low, reaction time) and throughput for the situation (HPS after taking out what the raid decides: damage per healer, healer count, kill
// length, tank share). Each is a percentile in a reference pool of other raids' healers
// (healerScoreRef.json, built by scripts/healer-score-ref.ts). See docs/healer-score.md.
import type { HealerMetrics } from './types.ts';

export const SCORE_METRICS = [
  { key: 'hpm', label: 'Healing per mana', dir: 1 },
  { key: 'ownOverheal', label: 'Overheal by your own choice', dir: -1 },
  { key: 'idle', label: 'Idle while someone you heal is low', dir: -1 },
  { key: 'reaction', label: 'Reaction to a drop below 50%', dir: -1 },
  { key: 'hps', label: 'HPS for your situation', dir: 1 },
] as const;
export type ScoreMetric = (typeof SCORE_METRICS)[number]['key'];
// Mana left at the end was a sixth: it added nothing to how steady the score is from week to week
// (0.62 with and without), and penalising it rewards dumping mana into heals nobody needed.
const HABITS: ScoreMetric[] = ['hpm', 'ownOverheal', 'idle', 'reaction'];

/** What the score needs from one healer on one kill: small enough to keep for every kill. */
export interface HealerScoreInputs {
  spec: string;
  values: Partial<Record<ScoreMetric, number>>;
  dtpsPerHealer: number;
  healers: number;
  durationSec: number;
  tankShare: number;
}

export interface HealerScoreRef {
  /** Changes when the pool is rebuilt. */
  version: string;
  pool: string;
  /** Per spec: per metric, the context fit and the pool's adjusted values at every 2nd percentile. */
  specs: Record<
    string,
    {
      healers: number;
      kills: number;
      metrics: Partial<Record<ScoreMetric, { beta: number[]; q: number[] }>>;
      /** The spec's usual share of a kill's healer healing, times the healer count (1 = an even split). */
      share: number;
    }
  >;
  /**
   * Per boss (encounter id): how far the pool's percentiles on that boss sit from 50, per metric.
   * The context fit doesn't take out what's particular to a fight (Council is easy to look good
   * on, Reliquary hard), so each part is moved by this much to put every boss on the same scale.
   */
  bosses: Record<string, { name: string; kills: number; offset: Partial<Record<ScoreMetric, number>>; split: number }>;
}

export interface HealerScore {
  score: number;
  /** Percentile per metric (higher is better), for the metrics the healer has. */
  parts: Partial<Record<ScoreMetric, number>>;
}

/** Overheal by the healer's own choice, as a share of all their healing. */
export const ownOverheal = (h: HealerMetrics) => {
  const direct = h.effective - h.absorbed;
  const over = direct ? (h.overhealPct * direct) / (1 - h.overhealPct || 1) : 0;
  return direct + over ? (h.overheal.ownChoice * over) / (direct + over) : 0;
};

export function scoreInputs(m: HealerMetrics): HealerScoreInputs {
  const values: HealerScoreInputs['values'] = {
    hpm: m.mana?.healPerMana,
    ownOverheal: ownOverheal(m),
    idle: m.idleWhileNeeded.ofSec >= 5 ? m.idleWhileNeeded.sec / m.idleWhileNeeded.ofSec : undefined,
    reaction: m.reaction.medianSec,
    hps: m.hps,
  };
  for (const k of Object.keys(values) as ScoreMetric[]) if (typeof values[k] !== 'number' || !Number.isFinite(values[k])) delete values[k];
  return {
    spec: m.specLabel,
    values,
    dtpsPerHealer: m.context.raidDtps / Math.max(1, m.context.raidHealers),
    healers: m.context.raidHealers,
    durationSec: m.durationSec,
    tankShare: m.tankShare,
  };
}

/** The raid context a metric is adjusted for, in the order of the fit's coefficients. */
export const contextOf = (s: Pick<HealerScoreInputs, 'dtpsPerHealer' | 'healers' | 'durationSec' | 'tankShare'>) => [
  1,
  s.dtpsPerHealer / 1000,
  s.healers,
  s.durationSec / 100,
  s.tankShare,
];

/** A metric's value minus what the raid context predicts for the spec. */
export const adjusted = (value: number, beta: number[], s: HealerScoreInputs) => value - contextOf(s).reduce((acc, c, i) => acc + c * beta[i], 0);

/** Percentile (0-100) of a value among the pool's, from its quantiles. */
function percentile(v: number, q: number[]) {
  const step = 100 / (q.length - 1);
  if (v <= q[0]) return 0;
  if (v >= q[q.length - 1]) return 100;
  let i = 0;
  while (q[i + 1] < v) i++;
  // Ties in the pool (several 0% mana ends) count half, as in the prototype.
  let j = i + 1;
  while (j < q.length - 1 && q[j + 1] === q[j]) j++;
  if (q[i + 1] === v) return ((i + 1 + j) / 2) * step;
  return (i + (v - q[i]) / (q[i + 1] - q[i])) * step;
}

/**
 * The score for one kill, or undefined if the spec isn't in the pool or too little was measured.
 * `encounterId`: the boss, for its correction (a boss the pool doesn't have gets none).
 */
export function healerScore(s: HealerScoreInputs, ref: HealerScoreRef, encounterId?: number): HealerScore | undefined {
  const spec = ref.specs[s.spec];
  if (!spec) return undefined;
  const parts: HealerScore['parts'] = {};
  for (const { key, dir } of SCORE_METRICS) {
    const v = s.values[key];
    const fit = spec.metrics[key];
    if (v === undefined || !fit) continue;
    const p = percentile(adjusted(v, fit.beta, s), fit.q);
    const offset = (encounterId !== undefined && ref.bosses?.[encounterId]?.offset[key]) || 0;
    parts[key] = Math.min(100, Math.max(0, (dir === 1 ? p : 100 - p) - offset));
  }
  const habits = HABITS.map((k) => parts[k]).filter((v): v is number => v !== undefined);
  // Idle and reaction need someone to drop low: a calm kill for a tank healer may have neither.
  if (habits.length < 2 || parts.hps === undefined) return undefined;
  return { score: (habits.reduce((a, b) => a + b, 0) / habits.length + parts.hps) / 2, parts };
}

/**
 * How far an average over several kills can be trusted (0-1): one night's 8 kills against the next
 * week's were 0.49 alike, so by Spearman-Brown about 0.66 at 16 kills and 0.8 at 32.
 */
export const reliability = (kills: number) => {
  const k = kills / 8;
  return (k * 0.49) / (1 + (k - 1) * 0.49);
};

/**
 * How unevenly a kill's healing was split between its healers: each healer's share of the healers'
 * healing, times the healer count and over what their spec usually gets (1 = their usual share),
 * and the top healer's over the lowest's. When healers take turns holding back so one of them gets
 * a high healing parse, the split is far more lopsided than in other raids on the same boss.
 * `uneven`: above the pool's 95th percentile for the boss (bosses the pool lacks aren't judged).
 */
export interface HealingSplit {
  shares: { name: string; share: number }[];
  spread: number;
  threshold?: number;
  uneven: boolean;
}

export function healingSplit(healers: { name: string; spec: string; hps: number }[], ref: HealerScoreRef, encounterId?: number): HealingSplit | undefined {
  const known = healers.filter((h) => ref.specs[h.spec] && h.hps > 0);
  // Two healers (Zul'Aman) split however the assignment says; three is the least to judge.
  if (known.length < 3) return undefined;
  const total = known.reduce((sum, h) => sum + h.hps, 0);
  const shares = known.map((h) => ({ name: h.name, share: ((h.hps / total) * known.length) / ref.specs[h.spec].share })).sort((a, b) => b.share - a.share);
  const spread = shares[0].share / shares[shares.length - 1].share;
  const threshold = encounterId !== undefined ? ref.bosses?.[encounterId]?.split : undefined;
  return { shares, spread, threshold, uneven: threshold !== undefined && spread > threshold };
}
