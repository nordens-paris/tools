// Prototype: can a healer execution score beat healing parses? Collects every healer on the Hyjal
// kills (Rage Winterchill to Azgalor) of well-run raids (top of Kaz'rogal's execution ranking) and
// ordinary ones (the bottom of the 1,000 it lists), turns the metrics a healer controls into
// percentiles within their spec, and checks the score three ways:
//   1. Consistency: the same healer's score on two kills of the same night.
//   2. Raid independence: how much the score follows the raid's damage taken per healer and healer
//      count (it shouldn't; HPS and healing share do).
//   3. Separation: well-run raids' healers should score higher than ordinary raids'.
// HPS and share of raid healing (what healing parses rank) are shown as the baseline.
//
//   npx tsx --env-file=.env scripts/healer-score.ts [--set=hyjal|bt|btweeks] [--raids=8] [--refresh] [--adjust] [--across-nights]
//
// Collected metrics are saved in .cache/healer-score-samples.json, so changing the scoring doesn't
// fetch again (--refresh does). About 9 requests per kill: 8 + 8 raids x 4 bosses is ~600.
import fs from 'node:fs';
import type { HealerMetrics } from '../shared/types.ts';
import { fetchHealerFight } from '../server/analysis/healer/data.ts';
import { healerMetrics, ownOverheal } from '../server/analysis/healer/metrics.ts';
import { FightModel } from '../server/analysis/healer/model.ts';
import { WclClient } from '../server/wcl/client.ts';

const args = process.argv.slice(2);
const RAIDS = Number(args.find((a) => a.startsWith('--raids='))?.split('=')[1] ?? 8);
// --set=bt: the heavy-healing Black Temple bosses (Gurtogg, Reliquary, Mother Shahraz, Council),
// ranked on Gurtogg; default Hyjal before Archimonde, ranked on Kaz'rogal.
const SET = args.find((a) => a.startsWith('--set='))?.split('=')[1] ?? 'hyjal';
const SETS: Record<string, { rankedOn: number; bosses: number[] }> = {
  hyjal: { rankedOn: 50620, bosses: [50618, 50619, 50620, 50621] },
  bt: { rankedOn: 50605, bosses: [50605, 50606, 50607, 50608] },
  // Written by scripts/healer-weeks.ts (several nights per guild); not collected here.
  btweeks: { rankedOn: 50605, bosses: [50605, 50606, 50607, 50608] },
};
// --across-nights: a healer is guild + name over all their reports, and "night" compares their
// even nights with their odd ones (week to week) instead of kills within a night.
const ACROSS = args.includes('--across-nights');
const OUT = `.cache/healer-score-samples${SET === 'hyjal' ? '' : `-${SET}`}.json`;
const RANKED_ON = SETS[SET].rankedOn;
const BOSSES = new Set(SETS[SET].bosses);
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);

interface Sample {
  group: 'good' | 'ordinary';
  guild?: string;
  night?: number;
  report: string;
  fight: number;
  boss: string;
  name: string;
  spec: string;
  durationSec: number;
  healers: number;
  dtpsPerHealer: number;
  m: HealerMetrics;
}

async function collect(): Promise<Sample[]> {
  const samples: Sample[] = [];
  const pick = async (page: number) => {
    const r = await client.raidRankings(RANKED_ON, 'execution', page);
    return [...new Set(r.rankings.filter((x) => x.deaths <= 2).map((x) => x.reportID))].slice(0, RAIDS);
  };
  const groups = { good: await pick(1), ordinary: await pick(20) };
  for (const [group, reports] of Object.entries(groups) as ['good' | 'ordinary', string[]][]) {
    for (const report of reports) {
      try {
        const fights = await client.fights(report);
        const kills = fights.fights.filter((f) => f.kill && BOSSES.has(f.boss));
        await Promise.all(
          kills.map(async (f) => {
            const model = new FightModel(await fetchHealerFight(client, report, f.id, fights));
            for (const [id, spec] of model.healers) {
              const m = healerMetrics(model, id);
              samples.push({ group, report, fight: f.id, boss: f.name, name: m.name, spec: spec.label, durationSec: model.durationSec, healers: model.healers.size, dtpsPerHealer: model.raidDtps / model.healers.size, m });
            }
          }),
        );
        console.log(`${group} ${report}: ${kills.length} kills, ${samples.length} healer kills so far`);
      } catch (err) {
        console.log(`${group} ${report}: skipped (${(err as Error).message})`);
      }
    }
  }
  fs.mkdirSync('.cache', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(samples));
  return samples;
}

const samples: Sample[] = !args.includes('--refresh') && fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : await collect();

// The metrics, grouped into parts. dir: +1 higher is better, -1 lower is better.
type Metric = { key: string; part: string; dir: 1 | -1; get: (m: HealerMetrics) => number | null | undefined };
const ofKill = (sec: number | undefined, m: HealerMetrics) => (sec === undefined || !m.durationSec ? null : sec / m.durationSec);
const upkeep = (name: string) => (m: HealerMetrics) => m.upkeep.find((u) => u.name === name)?.uptime;
const METRICS: Metric[] = [
  { key: 'reaction', part: 'responsiveness', dir: -1, get: (m) => m.reaction.medianSec },
  { key: 'first', part: 'responsiveness', dir: 1, get: (m) => m.reaction.firstResponder },
  { key: 'idle', part: 'responsiveness', dir: -1, get: (m) => (m.idleWhileNeeded.ofSec >= 5 ? m.idleWhileNeeded.sec / m.idleWhileNeeded.ofSec : null) },
  { key: 'hpm', part: 'efficiency', dir: 1, get: (m) => m.mana?.healPerMana },
  { key: 'ownOverheal', part: 'efficiency', dir: -1, get: (m) => ownOverheal(m) },
  { key: 'cancelLost', part: 'efficiency', dir: -1, get: (m) => ofKill(m.cancels.secLost, m) },
  { key: 'manaEnd', part: 'efficiency', dir: -1, get: (m) => m.mana?.end },
  { key: 'savesPerDrop', part: 'impact', dir: 1, get: (m) => (m.reaction.drops >= 3 ? m.saves / m.reaction.drops : null) },
  { key: 'preheal', part: 'impact', dir: 1, get: (m) => m.tankPreheal?.prehealEffective },
  { key: 'earthShield', part: 'upkeep', dir: 1, get: upkeep('Earth Shield') },
  { key: 'lifebloom', part: 'upkeep', dir: 1, get: upkeep('Lifebloom') },
];
// Outcomes from scripts/healer-outcomes.ts (what the healing prevented), when computed.
const OUTCOMES_FILE = OUT.replace('healer-score-samples', 'healer-outcomes');
const outcomes: Record<string, { critShare: number; triage: number; lethalPerMin: number; safety: number }> = fs.existsSync(OUTCOMES_FILE) ? JSON.parse(fs.readFileSync(OUTCOMES_FILE, 'utf8')) : {};
const outcomeOf = (m: HealerMetrics) => currentOutcomes.get(m);
const currentOutcomes = new Map<HealerMetrics, (typeof outcomes)[string]>();
for (const s of samples) if (outcomes[`${s.report}:${s.fight}:${s.name}`]) currentOutcomes.set(s.m, outcomes[`${s.report}:${s.fight}:${s.name}`]);
const OUTCOME: Metric[] = [
  { key: 'out:safety', part: 'outcome', dir: 1, get: (m) => outcomeOf(m)?.safety },
  { key: 'out:triage', part: 'outcome', dir: 1, get: (m) => outcomeOf(m)?.triage },
  { key: 'out:critShare', part: 'outcome', dir: 1, get: (m) => outcomeOf(m)?.critShare },
  { key: 'out:lethal/min', part: 'outcome', dir: 1, get: (m) => outcomeOf(m)?.lethalPerMin },
];
const BASELINE: Metric[] = [
  { key: 'HPS', part: 'parse', dir: 1, get: (m) => m.hps },
  { key: 'raidShare', part: 'parse', dir: 1, get: (m) => m.shareOfRaid },
];

// Percentile (0-100) of a value among the same spec's samples, with the metric's direction.
const valuesBySpec = new Map<string, Map<string, number[]>>();
for (const s of samples)
  for (const met of [...METRICS, ...BASELINE, ...OUTCOME]) {
    const v = met.get(s.m);
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const bySpec = valuesBySpec.get(s.spec) ?? new Map<string, number[]>();
    valuesBySpec.set(s.spec, bySpec);
    bySpec.set(met.key, [...(bySpec.get(met.key) ?? []), v]);
  }
// --adjust: each metric's value minus what the raid context predicts (least squares within the
// spec on damage taken per healer, healer count, kill time and tank share), so the percentile
// compares healers who had the same situation.
const ADJUST = args.includes('--adjust');
const contextOf = (s: Sample) => [1, s.dtpsPerHealer / 1000, s.healers, s.durationSec / 100, s.m.tankShare];
function solve(a: number[][], b: number[]): number[] {
  // Normal equations with a little ridge, by Gaussian elimination.
  const n = a[0].length;
  const m = Array.from({ length: n }, (_, i) => [...Array.from({ length: n }, (_, j) => a.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? 1e-6 : 0)), a.reduce((s, r, k) => s + r[i] * b[k], 0)]);
  for (let i = 0; i < n; i++) {
    const p = m.slice(i).reduce((best, r, k) => (Math.abs(r[i]) > Math.abs(m[best][i]) ? i + k : best), i);
    [m[i], m[p]] = [m[p], m[i]];
    for (let k = 0; k < n; k++) if (k !== i) { const f = m[k][i] / m[i][i]; for (let j = i; j <= n; j++) m[k][j] -= f * m[i][j]; }
  }
  return m.map((r, i) => r[n] / r[i]);
}
const fits = new Map<string, number[]>();
function valueOf(s: Sample, met: Metric): number | null {
  const v = met.get(s.m);
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (!ADJUST) return v;
  const key = `${s.spec}:${met.key}`;
  if (!fits.has(key)) {
    const rows = samples.filter((x) => x.spec === s.spec && typeof met.get(x.m) === 'number' && Number.isFinite(met.get(x.m) as number));
    fits.set(key, rows.length >= 15 ? solve(rows.map(contextOf), rows.map((x) => met.get(x.m) as number)) : [0, 0, 0, 0, 0]);
  }
  const beta = fits.get(key)!;
  return v - contextOf(s).reduce((acc, c, i) => acc + c * beta[i], 0);
}
function pct(s: Sample, met: Metric): number | null {
  const v = valueOf(s, met);
  const pool = ADJUST
    ? samples.filter((x) => x.spec === s.spec).map((x) => valueOf(x, met)).filter((x): x is number => x !== null)
    : (valuesBySpec.get(s.spec)?.get(met.key) ?? []);
  if (typeof v !== 'number' || !Number.isFinite(v) || pool.length < 8) return null;
  const below = pool.filter((x) => x < v).length + pool.filter((x) => x === v).length / 2;
  const p = (below / pool.length) * 100;
  return met.dir === 1 ? p : 100 - p;
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const PARTS = [...new Set(METRICS.map((m) => m.part))];
type Scored = Sample & { scores: Record<string, number> };
const scored: Scored[] = samples.map((s) => {
  const scores: Record<string, number> = {};
  for (const met of [...METRICS, ...BASELINE, ...OUTCOME]) {
    const p = pct(s, met);
    if (p !== null) scores[met.key] = p;
  }
  // A part is the mean of its metrics; the score the mean of the parts the healer has.
  const parts = PARTS.map((part) => avg(METRICS.filter((m) => m.part === part && scores[m.key] !== undefined).map((m) => scores[m.key]))).filter(Number.isFinite);
  PARTS.forEach((part) => {
    const v = avg(METRICS.filter((m) => m.part === part && scores[m.key] !== undefined).map((m) => scores[m.key]));
    if (Number.isFinite(v)) scores[`part:${part}`] = v;
  });
  if (parts.length >= 2) scores.SCORE = avg(parts);
  // Candidate from the cross-validation (healer-crossval.ts): equal weights on the four metrics
  // that best predicted what the healing prevented.
  const impact = ['first', 'savesPerDrop', 'preheal', 'ownOverheal'].map((k) => scores[k]).filter((v) => v !== undefined);
  if (impact.length >= 2) scores.IMPACT4 = avg(impact);
  // Candidate from the week-to-week check (--set=btweeks --across-nights): the metrics that are a
  // stable trait of the healer. Cancelled casts are left out: also stable, but cancelling to avoid
  // overheal is a technique, so less isn't simply better.
  const habits = ['hpm', 'ownOverheal', 'idle', 'reaction', 'manaEnd'].map((k) => scores[k]).filter((v) => v !== undefined);
  if (habits.length >= 3) scores.HABITS = avg(habits);
  // Habits plus throughput for the situation (HPS with --adjust: compared with healers who had the
  // same damage per healer, healer count, kill time and tank share).
  if (scores.HABITS !== undefined && scores.HPS !== undefined) scores.COMBINED = (scores.HABITS + scores.HPS) / 2;
  return { ...s, scores };
});

// Statistics.
const corr = (xs: number[], ys: number[]) => {
  const n = xs.length;
  if (n < 5) return NaN;
  const mx = avg(xs), my = avg(ys);
  const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const vx = xs.reduce((s, x) => s + (x - mx) ** 2, 0), vy = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  return cov / Math.sqrt(vx * vy);
};
const sd = (xs: number[]) => Math.sqrt(avg(xs.map((x) => (x - avg(xs)) ** 2)));
const cohensD = (a: number[], b: number[]) => (avg(a) - avg(b)) / Math.sqrt((sd(a) ** 2 + sd(b) ** 2) / 2);

const byHealer = new Map<string, Scored[]>();
const healerKey = (s: Sample) => (ACROSS ? `${s.guild}:${s.name}` : `${s.report}:${s.name}`);
for (const s of scored) byHealer.set(healerKey(s), [...(byHealer.get(healerKey(s)) ?? []), s]);

function pairs(rows: Scored[], a: string, b: string): [number[], number[]] {
  const both = rows.filter((r) => r.scores[a] !== undefined && r.scores[b] !== undefined);
  return [both.map((r) => r.scores[a]), both.map((r) => r.scores[b])];
}
function check(key: string) {
  // 1. Consistency: every pair of the same healer's kills, as (first, second) points.
  const xs: number[] = [], ys: number[] = [];
  for (const kills of byHealer.values()) {
    const vals = kills.map((k) => k.scores[key]).filter((v) => v !== undefined);
    for (let i = 0; i < vals.length; i++) for (let j = i + 1; j < vals.length; j++) (xs.push(vals[i]), ys.push(vals[j]));
  }
  // Over a night: the mean of a healer's odd kills against the mean of their even ones.
  const nx: number[] = [], ny: number[] = [];
  for (const kills of byHealer.values()) {
    const have = kills.filter((k) => k.scores[key] !== undefined);
    if (ACROSS) {
      const even = have.filter((k) => (k.night ?? 0) % 2 === 0).map((k) => k.scores[key]);
      const odd = have.filter((k) => (k.night ?? 0) % 2 === 1).map((k) => k.scores[key]);
      if (even.length < 2 || odd.length < 2) continue;
      nx.push(avg(even));
      ny.push(avg(odd));
      continue;
    }
    const vals = have.map((k) => k.scores[key]);
    if (vals.length < 4) continue;
    nx.push(avg(vals.filter((_, i) => i % 2 === 0)));
    ny.push(avg(vals.filter((_, i) => i % 2 === 1)));
  }
  const have = scored.filter((s) => s.scores[key] !== undefined);
  const v = have.map((s) => s.scores[key]);
  return {
    n: have.length,
    consistency: corr(xs, ys),
    night: corr(nx, ny),
    vsDamage: corr(v, have.map((s) => s.dtpsPerHealer)),
    vsHealers: corr(v, have.map((s) => s.healers)),
    separation: cohensD(have.filter((s) => s.group === 'good').map((s) => s.scores[key]), have.filter((s) => s.group === 'ordinary').map((s) => s.scores[key])),
    // Validity: does it predict what the healing prevented (within-kill, so context-free)?
    predicts: corr(...pairs(have, key, 'out:safety')),
    good: avg(have.filter((s) => s.group === 'good').map((s) => s.scores[key])),
    ordinary: avg(have.filter((s) => s.group === 'ordinary').map((s) => s.scores[key])),
  };
}

// Per healer (mean over their kills): averaging cuts the noise in both the metric and the outcome,
// which otherwise caps any correlation between them.
function healerLevel(key: string, outcome: string) {
  const xs: number[] = [], ys: number[] = [];
  for (const kills of byHealer.values()) {
    const both = kills.filter((k) => k.scores[key] !== undefined && k.scores[outcome] !== undefined);
    if (both.length < 2) continue;
    xs.push(avg(both.map((k) => k.scores[key])));
    ys.push(avg(both.map((k) => k.scores[outcome])));
  }
  return corr(xs, ys);
}
// For scripts/healer-crossval.ts: each healer's mean percentiles over their kills.
fs.writeFileSync(
  OUT.replace('healer-score-samples', `healer-levels${ADJUST ? '-adjusted' : ''}`),
  JSON.stringify(
    [...byHealer].map(([id, kills]) => {
      const keys = new Set(kills.flatMap((k) => Object.keys(k.scores)));
      return { id, spec: kills[0].spec, kills: kills.length, means: Object.fromEntries([...keys].map((k) => [k, avg(kills.map((x) => x.scores[k]).filter((v) => v !== undefined))])) };
    }),
  ),
);
const specs = [...new Set(samples.map((s) => s.spec))];
console.log(`\n${samples.length} healer kills, ${byHealer.size} healers, ${new Set(samples.map((s) => s.report)).size} raids (${samples.filter((s) => s.group === 'good').length} good / ${samples.filter((s) => s.group === 'ordinary').length} ordinary)`);
console.log(`Specs: ${specs.map((sp) => `${sp} ${samples.filter((s) => s.spec === sp).length}`).join(', ')}`);
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d).padStart(6) : '     -');
console.log(`\n${ADJUST ? 'Adjusted for raid context.\n' : ''}metric               n  consist  night  vsDmg/healer  vsHealers  separation  predicts  perHealer  good  ordinary`);
for (const key of ['SCORE', 'IMPACT4', 'HABITS', 'COMBINED', ...PARTS.map((p) => `part:${p}`), ...METRICS.map((m) => m.key), ...BASELINE.map((m) => m.key), ...OUTCOME.map((m) => m.key)]) {
  const c = check(key);
  console.log(`${key.padEnd(18)} ${String(c.n).padStart(4)}  ${f(c.consistency)} ${f(c.night)}  ${f(c.vsDamage)}       ${f(c.vsHealers)}    ${f(c.separation)}    ${f(c.predicts)}    ${f(healerLevel(key, 'out:safety'))}  ${f(c.good, 0)}  ${f(c.ordinary, 0)}`);
}
console.log('\nconsist: correlation of the same healer between kills (higher = more a trait of the player).');
console.log('vsDmg/healer, vsHealers: correlation with the raid context (near 0 = fair across raids).');
console.log('separation: Cohen\'s d, well-run raids minus ordinary (0.2 small, 0.5 medium, 0.8 large).');
