// Builds the healer score's reference pool (shared/healerScoreRef.json) from the kills the
// prototype collected (scripts/healer-score.ts, scripts/healer-weeks.ts and
// scripts/healer-pool-bosses.ts): per spec, the context fit of each metric and the pool's adjusted
// values at every 2nd percentile; per boss, how far the pool's percentiles there sit from 50, and
// how lopsided a kill's healing split can be before it's flagged (kills above that are left out of
// the fits). No
// requests: it reads .cache/healer-score-samples*.json, and the reports' fight lists (for the boss
// ids) from the request cache. Rebuild when gear moves on (a new phase), after collecting new kills.
//
//   npx tsx --env-file=.env scripts/healer-score-ref.ts
import fs from 'node:fs';
import { SCORE_METRICS, adjusted, contextOf, healerScore, healingShares, healingSplit, scoreInputs, type HealerScoreInputs, type HealerScoreRef, type ScoreMetric } from '../shared/healerScore.ts';
import type { HealerMetrics } from '../shared/types.ts';
import { ANETHERON } from '../shared/healerScore.ts';
import { fetchHealerFight } from '../server/analysis/healer/data.ts';
import { healerMetrics } from '../server/analysis/healer/metrics.ts';
import { FightModel } from '../server/analysis/healer/model.ts';
import { WclClient } from '../server/wcl/client.ts';

const SETS = ['', '-bt', '-btweeks', '-bosses'];
const OUT = 'shared/healerScoreRef.json';
const MIN_POOL = 15;
// A boss's offset is pulled toward 0 as if it had this many more kills at 50: a boss with few
// kills in the pool gets little correction.
const SHRINK = 20;
// A boss with fewer kills than this in the pool gets the split threshold of all bosses together,
// or its own if higher (a fight whose splits are normally lopsided isn't flagged more for it).
const MIN_SPLIT_KILLS = 30;
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);

interface Sample {
  report: string;
  fight: number;
  boss: string;
  name: string;
  guild?: string;
  night?: number;
  bossId?: number;
  m: HealerMetrics;
}
// The same kill can be in two sets (Black Temple raids from the ranking and from the week list).
const seen = new Set<string>();
const rows: { kill: string; name: string; healer: string; guild?: string; night?: number; boss: number; bossName: string; s: HealerScoreInputs }[] = [];
const bossNames = new Map<number, string>();
const idOfName = new Map<string, number>();
for (const set of SETS) {
  const file = `.cache/healer-score-samples${set}.json`;
  if (!fs.existsSync(file)) continue;
  for (const x of JSON.parse(fs.readFileSync(file, 'utf8')) as Sample[]) {
    const key = `${x.report}:${x.fight}:${x.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // A report made private since has no fight list; its boss is found by name below.
    const fight = (await client.fights(x.report).catch(() => undefined))?.fights.find((f) => f.id === x.fight);
    const boss = x.bossId ?? fight?.boss ?? 0;
    if (boss) idOfName.set(x.boss, boss);
    // Samples from before Carrion Swarm was measured.
    if (ANETHERON.has(boss) && x.m.carrionSwarmSec === undefined) {
      const model = await fetchHealerFight(client, x.report, x.fight).then((d) => new FightModel(d)).catch(() => undefined);
      const id = model && [...model.players.values()].find((a) => a.name === x.name)?.id;
      if (model && id !== undefined && (model.healers.has(id) || model.minorHealers.has(id))) x.m.carrionSwarmSec = healerMetrics(model, id).carrionSwarmSec;
      else console.warn(`No Carrion Swarm for ${x.name} on ${x.report}:${x.fight}: left uncorrected`);
    }
    // Names in English where any report has them (some raids log in Korean).
    if (fight && (/^[\x20-\x7e]+$/.test(fight.name) || !bossNames.has(boss))) bossNames.set(boss, fight.name);
    rows.push({ kill: `${x.report}:${x.fight}`, name: x.name, healer: x.guild ? `${x.guild}:${x.name}` : `${x.report}:${x.name}`, guild: x.guild, night: x.night, boss, bossName: x.boss, s: scoreInputs(x.m) });
  }
}
for (const r of rows) r.boss ||= idOfName.get(r.bossName) ?? 0;
for (const r of rows) r.bossName = bossNames.get(r.boss) ?? r.bossName;

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
const round = (v: number) => Number(v.toPrecision(4));
const quantiles = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return Array.from({ length: 51 }, (_, i) => {
    const pos = (i / 50) * (sorted.length - 1);
    const lo = Math.floor(pos);
    return round(sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo));
  });
};
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const quantile = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const ref: HealerScoreRef = { version: new Date().toISOString().slice(0, 10), pool: '', specs: {}, bosses: {} };

// The healing split. Each spec's usual share of a kill's healer healing (times the healer count),
// then per boss the 95th percentile of how lopsided a kill's split is, top healer over lowest.
// Kills above it (healers taking turns holding back so one gets a high parse, or a raid that leaned
// on one healer) are left out of the fits below, so they don't stretch the HPS scale.
const byKill = new Map<string, typeof rows>();
for (const r of rows) byKill.set(r.kill, [...(byKill.get(r.kill) ?? []), r]);
const rawShares = new Map<string, number[]>();
for (const ks of byKill.values()) {
  const total = ks.reduce((sum, k) => sum + (k.s.values.hps ?? 0), 0);
  for (const k of ks) if (total) rawShares.set(k.s.spec, [...(rawShares.get(k.s.spec) ?? []), ((k.s.values.hps ?? 0) / total) * ks.length]);
}
const specs = [...rawShares.keys()].sort();
for (const spec of specs) ref.specs[spec] = { healers: 0, kills: 0, metrics: {}, share: round(median(rawShares.get(spec)!)) };
const spreads = new Map<string, { boss: number; spread: number }>();
for (const [kill, ks] of byKill) {
  const split = healingSplit(ks.map((k) => ({ name: k.name, spec: k.s.spec, hps: k.s.values.hps ?? 0 })), ref);
  if (split) spreads.set(kill, { boss: ks[0].boss, spread: split.spread });
}
const allSplit = quantile([...spreads.values()].map((x) => x.spread), 0.95);
const splitOf = new Map<number, { threshold: number; kills: number }>();
for (const boss of new Set([...spreads.values()].map((x) => x.boss))) {
  const xs = [...spreads.values()].filter((x) => x.boss === boss).map((x) => x.spread);
  splitOf.set(boss, { threshold: round(xs.length >= MIN_SPLIT_KILLS ? quantile(xs, 0.95) : Math.max(allSplit, quantile(xs, 0.95))), kills: xs.length });
}
const flagged = new Set([...spreads].filter(([, x]) => x.spread > splitOf.get(x.boss)!.threshold).map(([kill]) => kill));

// Held back (shared/healerScore.ts heldBack): per boss, the pool's lowest 3% of a healer's share
// against their usual share that night (their other kills of the night, at least 3).
const shareOf = new Map<(typeof rows)[number], number>();
for (const ks of byKill.values()) {
  const shares = healingShares(ks.map((k) => ({ name: k.name, inputs: k.s })), ref);
  for (const k of ks) shareOf.set(k, shares.get(k.name) ?? 0);
}
const nightOf = (r: (typeof rows)[number]) => `${r.guild ? `${r.guild}:${r.night}` : r.kill.split(':')[0]}:${r.name}`;
const byNight = new Map<string, typeof rows>();
for (const r of rows) byNight.set(nightOf(r), [...(byNight.get(nightOf(r)) ?? []), r]);
const relByBoss = new Map<number, number[]>();
for (const r of rows) {
  const own = byNight.get(nightOf(r))!.filter((x) => x !== r).map((x) => shareOf.get(x)!);
  if (own.length < 3) continue;
  relByBoss.set(r.boss, [...(relByBoss.get(r.boss) ?? []), shareOf.get(r)! / median(own)]);
}
const all = rows.length;
rows.splice(0, rows.length, ...rows.filter((r) => !flagged.has(r.kill)));

for (const spec of specs) {
  const ofSpec = rows.filter((r) => r.s.spec === spec);
  const metrics: HealerScoreRef['specs'][string]['metrics'] = {};
  for (const { key } of SCORE_METRICS) {
    const have = ofSpec.filter((r) => r.s.values[key] !== undefined);
    if (have.length < MIN_POOL) continue;
    const beta = solve(have.map((r) => contextOf(r.s)), have.map((r) => r.s.values[key]!));
    metrics[key] = { beta: beta.map(round), q: quantiles(have.map((r) => adjusted(r.s.values[key]!, beta, r.s))) };
  }
  ref.specs[spec] = { ...ref.specs[spec], healers: new Set(ofSpec.map((r) => r.healer)).size, kills: ofSpec.length, metrics };
}

// Boss offsets, from the uncorrected parts of every spec's kills on the boss.
const uncorrected = rows.map((r) => ({ ...r, sc: healerScore(r.s, ref) }));
for (const boss of [...new Set(rows.map((r) => r.boss))].sort()) {
  const on = uncorrected.filter((r) => r.boss === boss && r.sc);
  if (on.length < MIN_POOL) continue;
  const offset: Partial<Record<ScoreMetric, number>> = {};
  for (const { key } of SCORE_METRICS) {
    const xs = on.map((r) => r.sc!.parts[key]).filter((v): v is number => v !== undefined);
    if (xs.length >= MIN_POOL) offset[key] = Number((((avg(xs) - 50) * xs.length) / (xs.length + SHRINK)).toFixed(1));
  }
  const rel = relByBoss.get(boss);
  ref.bosses[boss] = { name: bossNames.get(boss) ?? String(boss), kills: on.length, offset, split: splitOf.get(boss)?.threshold ?? allSplit, ...(rel && rel.length >= MIN_SPLIT_KILLS ? { heldBack: round(quantile(rel, 0.03)) } : {}) };
}
const healers = new Set(rows.map((r) => r.healer)).size;
ref.pool = `${rows.length} healer kills, ${healers} healers on every boss of Hyjal and Black Temple, from raids across the execution rankings`;
fs.writeFileSync(OUT, `${JSON.stringify(ref)}\n`);

// Checks: the pool centres on 50 for every spec and, corrected, on every boss; and per boss, the
// same healers' score there against their own average (before and after the correction).
const scored = rows.map((r) => ({ ...r, before: healerScore(r.s, ref)?.score, after: healerScore(r.s, ref, r.boss)?.score }));
console.log(`${OUT}: ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB, ${ref.pool}`);
console.log(`Uneven healing split: ${flagged.size} of ${spreads.size} kills left out (${all - rows.length} healer kills); all bosses' threshold ${allSplit.toFixed(2)}`);
for (const [boss, x] of splitOf) console.log(`  ${(bossNames.get(boss) ?? String(boss)).padEnd(24)} ${String(x.kills).padStart(3)} kills, threshold ${x.threshold.toFixed(2)}${x.kills < MIN_SPLIT_KILLS ? ' (few kills)' : ''}`);
console.log(`Held back, share against usual: ${Object.values(ref.bosses).map((b) => `${b.name} ${b.heldBack ?? '-'}`).join(', ')}`);
console.log(`Spec shares: ${specs.map((sp) => `${sp} ${ref.specs[sp].share}`).join(', ')}`);
for (const [spec, s] of Object.entries(ref.specs)) {
  const xs = scored.filter((r) => r.s.spec === spec && r.after !== undefined).map((r) => r.after!);
  const mean = avg(xs);
  const sd = Math.sqrt(avg(xs.map((x) => (x - mean) ** 2)));
  console.log(`  ${spec.padEnd(20)} ${String(s.kills).padStart(4)} kills, ${String(s.healers).padStart(3)} healers, scored ${xs.length}: mean ${mean.toFixed(1)}, sd ${sd.toFixed(1)}`);
}
const own = (field: 'before' | 'after') => {
  const m = new Map<string, number>();
  for (const h of new Set(scored.map((r) => r.healer))) {
    const xs = scored.filter((r) => r.healer === h && r[field] !== undefined).map((r) => r[field]!);
    if (xs.length) m.set(h, avg(xs));
  }
  return m;
};
const ownBefore = own('before'), ownAfter = own('after');
console.log('\nboss                      kills  mean before  after   vs own before  after');
for (const [boss, b] of Object.entries(ref.bosses)) {
  const on = scored.filter((r) => String(r.boss) === boss && r.before !== undefined);
  const vs = (field: 'before' | 'after', m: Map<string, number>) => avg(on.map((r) => r[field]! - m.get(r.healer)!));
  console.log(`  ${b.name.padEnd(24)} ${String(on.length).padStart(4)}  ${avg(on.map((r) => r.before!)).toFixed(1).padStart(10)}  ${avg(on.map((r) => r.after!)).toFixed(1).padStart(5)}  ${vs('before', ownBefore).toFixed(1).padStart(12)}  ${vs('after', ownAfter).toFixed(1).padStart(5)}`);
}
// Week to week (healers seen over several nights): even nights' average against odd nights'.
const corr = (xs: number[], ys: number[]) => {
  const mx = avg(xs), my = avg(ys);
  let c = 0, vx = 0, vy = 0;
  xs.forEach((x, i) => ((c += (x - mx) * (ys[i] - my)), (vx += (x - mx) ** 2), (vy += (ys[i] - my) ** 2)));
  return c / Math.sqrt(vx * vy);
};
for (const field of ['before', 'after'] as const) {
  const xs: number[] = [], ys: number[] = [];
  for (const h of new Set(scored.filter((r) => r.guild).map((r) => r.healer))) {
    const ks = scored.filter((r) => r.healer === h && r[field] !== undefined && r.night !== undefined);
    const even = ks.filter((k) => k.night! % 2 === 0).map((k) => k[field]!), odd = ks.filter((k) => k.night! % 2 === 1).map((k) => k[field]!);
    if (even.length >= 2 && odd.length >= 2) (xs.push(avg(even)), ys.push(avg(odd)));
  }
  console.log(`week to week ${field} the boss correction: ${corr(xs, ys).toFixed(2)} (${xs.length} healers)`);
}
