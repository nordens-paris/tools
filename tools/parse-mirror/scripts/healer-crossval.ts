// Cross-validation for the healer score prototype: fits weights that predict what a healer's heals
// prevented (out:safety from scripts/healer-outcomes.ts) from the metrics a healer controls, on one
// set of raids, and tests them on the other (Hyjal and Black Temple: different bosses, raids and
// healers). Per healer, means over their kills. Weights that predict raids they never saw measure
// something real; weights that only fit their own set don't.
// Run healer-score.ts --adjust for both sets first (it writes .cache/healer-levels-adjusted*.json).
//
//   npx tsx scripts/healer-crossval.ts [--target=out:safety]
import fs from 'node:fs';

const args = process.argv.slice(2);
const TARGET = args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'out:safety';
const FEATURES = ['reaction', 'first', 'idle', 'hpm', 'ownOverheal', 'cancelLost', 'manaEnd', 'savesPerDrop', 'preheal'];
type Level = { id: string; spec: string; kills: number; means: Record<string, number> };
const load = (set: string): Level[] => JSON.parse(fs.readFileSync(`.cache/healer-levels-adjusted${set ? `-${set}` : ''}.json`, 'utf8'));
const sets = { hyjal: load(''), bt: load('bt') };

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const corr = (xs: number[], ys: number[]) => {
  const mx = avg(xs), my = avg(ys);
  const c = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  return c / Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
};
// Missing metrics (no Earth Shield, too few drops) count as the middle, 50.
const row = (l: Level) => FEATURES.map((f) => (Number.isFinite(l.means[f]) ? l.means[f] : 50) - 50);
const usable = (ls: Level[]) => ls.filter((l) => l.kills >= 2 && Number.isFinite(l.means[TARGET]));

/** Ridge regression (standardised-ish: all features are percentiles), by Gaussian elimination. */
function fit(ls: Level[], lambda: number): number[] {
  const x = ls.map(row), y = ls.map((l) => l.means[TARGET] - 50), n = FEATURES.length;
  const m = Array.from({ length: n }, (_, i) => [...Array.from({ length: n }, (_, j) => x.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? lambda : 0)), x.reduce((s, r, k) => s + r[i] * y[k], 0)]);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = m[k][i] / m[i][i];
      for (let j = i; j <= n; j++) m[k][j] -= f * m[i][j];
    }
  }
  return m.map((r, i) => r[n] / r[i]);
}
const predict = (w: number[], ls: Level[]) => ls.map((l) => row(l).reduce((s, v, i) => s + v * w[i], 0));

console.log(`Target: ${TARGET} per healer. Healers with 2+ kills: Hyjal ${usable(sets.hyjal).length}, BT ${usable(sets.bt).length}`);
for (const lambda of [1000, 10000, 100000]) {
  const out: string[] = [];
  for (const [train, test] of [['hyjal', 'bt'], ['bt', 'hyjal']] as const) {
    const w = fit(usable(sets[train]), lambda);
    const tr = corr(predict(w, usable(sets[train])), usable(sets[train]).map((l) => l.means[TARGET]));
    const te = corr(predict(w, usable(sets[test])), usable(sets[test]).map((l) => l.means[TARGET]));
    out.push(`${train}->${test}: fit ${tr.toFixed(2)}, new raids ${te.toFixed(2)}`);
    if (lambda === 10000) console.log(`  weights from ${train}: ${FEATURES.map((f, i) => `${f} ${w[i] >= 0 ? '+' : ''}${w[i].toFixed(2)}`).join(', ')}`);
  }
  console.log(`ridge ${lambda}: ${out.join('   ')}`);
}
// Simple, unfitted alternatives on both sets.
for (const [label, feats] of [['first only', ['first']], ['equal: first, savesPerDrop, preheal, ownOverheal', ['first', 'savesPerDrop', 'preheal', 'ownOverheal']], ['equal: all', FEATURES]] as const) {
  const r = (ls: Level[]) => corr(ls.map((l) => avg(feats.map((f) => (Number.isFinite(l.means[f]) ? l.means[f] : 50)))), ls.map((l) => l.means[TARGET]));
  console.log(`${label.padEnd(48)} Hyjal ${r(usable(sets.hyjal)).toFixed(2)}   BT ${r(usable(sets.bt)).toFixed(2)}`);
}
// HPS (what healing parses rank), for comparison.
for (const key of ['HPS', 'raidShare']) {
  const r = (ls: Level[]) => corr(ls.map((l) => l.means[key]), ls.map((l) => l.means[TARGET]));
  console.log(`${key.padEnd(48)} Hyjal ${r(usable(sets.hyjal)).toFixed(2)}   BT ${r(usable(sets.bt)).toFixed(2)}`);
}
