// Outcome measures for the healer score prototype (scripts/healer-score.ts): what a healer's heals
// actually prevented, from the HP timelines in the log. For each heal: take it out, let later
// overheal on the same target (from anyone) refill the gap, and see whether the target would have
// dropped near death in the next seconds while in fact they lived. Such a heal is critical: no one
// else's healing would have covered it.
//   critShare: share of the healer's effective healing that was critical.
//   triage: their share of the kill's critical healing over their share of its healing (1 = as
//     much as their healing; within one kill, so the raid situation is the same for everyone).
//   lethal: critical heals that kept the target from dying outright, per minute.
//   safety: graded version for every heal: how far below 50% the target would have dropped
//     without it, minus how far they did (HP points kept out of danger), as a share of the kill's
//     total over its share of the healing, like triage.
// Reads the kills from .cache/healer-score-samples.json (run healer-score.ts first); the fight
// data comes from the request cache, so this makes no new requests for those kills.
//
//   npx tsx --env-file=.env scripts/healer-outcomes.ts [--set=hyjal|bt] [--window=6] [--crit=10]
import fs from 'node:fs';
import { fetchHealerFight } from '../server/analysis/healer/data.ts';
import { FightModel, type LogEvent } from '../server/analysis/healer/model.ts';
import { WclClient } from '../server/wcl/client.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const WINDOW_MS = flag('window', 6) * 1000;
const CRIT_PCT = flag('crit', 10);
const SAFE_PCT = 50;
const client = new WclClient(process.env.WCL_API_KEY!, process.env.WCL_HOST!);
const SET = args.find((a) => a.startsWith('--set='))?.split('=')[1] ?? 'hyjal';
const SAMPLES = `.cache/healer-score-samples${SET === 'hyjal' ? '' : `-${SET}`}.json`;
const samples: { report: string; fight: number; name: string }[] = JSON.parse(fs.readFileSync(SAMPLES, 'utf8'));

export interface Outcome {
  critShare: number;
  triage: number;
  lethalPerMin: number;
  safety: number;
  critical: number;
  heals: number;
}
const out: Record<string, Outcome> = {};
const kills = [...new Set(samples.map((s) => `${s.report}:${s.fight}`))];

for (const key of kills) {
  const [report, fight] = [key.split(':')[0], Number(key.split(':')[1])];
  const m = new FightModel(await fetchHealerFight(client, report, fight));
  // Overheal per target over time, to refill a removed heal's gap.
  const overheals = new Map<number, LogEvent[]>();
  for (const e of m.healing) if (e.targetID !== undefined && (e.overheal ?? 0) > 0) overheals.set(e.targetID, [...(overheals.get(e.targetID) ?? []), e]);
  const crit = new Map<number, number>();
  const eff = new Map<number, number>();
  const lethal = new Map<number, number>();
  const safety = new Map<number, number>();
  const count = new Map<number, { critical: number; heals: number }>();
  for (const e of m.healing) {
    const src = e.sourceID, tgt = e.targetID, amount = e.amount ?? 0;
    if (src === undefined || tgt === undefined || !m.healers.has(src) || !m.players.has(tgt) || amount <= 0 || !m.hasHp(tgt)) continue;
    eff.set(src, (eff.get(src) ?? 0) + amount);
    const c = count.get(src) ?? { critical: 0, heals: 0 };
    count.set(src, c);
    c.heals++;
    const t = e.timestamp;
    if (!m.alive(tgt, t + WINDOW_MS)) continue; // they died anyway: the heal didn't save them
    const max = m.maxHp(tgt).value;
    const removed = (amount / max) * 100;
    let refill = 0;
    const refills = (overheals.get(tgt) ?? []).filter((o) => o.timestamp > t && o.timestamp <= t + WINDOW_MS);
    let minCf = Infinity;
    let minHp = Infinity;
    let j = 0;
    for (const [pt, hp] of m.hpPoints(tgt, t + 1, t + WINDOW_MS)) {
      while (j < refills.length && refills[j].timestamp <= pt) refill += ((refills[j++].overheal ?? 0) / max) * 100;
      minCf = Math.min(minCf, hp - Math.max(0, removed - refill));
      minHp = Math.min(minHp, hp);
    }
    if (Number.isFinite(minCf)) safety.set(src, (safety.get(src) ?? 0) + Math.max(0, Math.max(0, SAFE_PCT - minCf) - Math.max(0, SAFE_PCT - minHp)));
    if (minCf <= CRIT_PCT) {
      crit.set(src, (crit.get(src) ?? 0) + amount);
      c.critical++;
      if (minCf <= 0) lethal.set(src, (lethal.get(src) ?? 0) + 1);
    }
  }
  const critAll = [...crit.values()].reduce((s, v) => s + v, 0);
  const effAll = [...eff.values()].reduce((s, v) => s + v, 0);
  const safeAll = [...safety.values()].reduce((s, v) => s + v, 0);
  for (const id of m.healers.keys()) {
    const e = eff.get(id) ?? 0, c = crit.get(id) ?? 0;
    out[`${report}:${fight}:${m.name(id)}`] = {
      critShare: e ? c / e : 0,
      triage: critAll && effAll && e ? c / critAll / (e / effAll) : NaN,
      safety: safeAll && effAll && e ? (safety.get(id) ?? 0) / safeAll / (e / effAll) : NaN,
      lethalPerMin: m.durationSec ? (lethal.get(id) ?? 0) / (m.durationSec / 60) : 0,
      critical: count.get(id)?.critical ?? 0,
      heals: count.get(id)?.heals ?? 0,
    };
  }
}
fs.writeFileSync(SAMPLES.replace('healer-score-samples', 'healer-outcomes'), JSON.stringify(out));
const vals = Object.values(out);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`${kills.length} kills, ${vals.length} healer kills: critical share ${(avg(vals.map((v) => v.critShare)) * 100).toFixed(1)}% of healing, ${avg(vals.map((v) => v.critical)).toFixed(1)} critical heals of ${avg(vals.map((v) => v.heals)).toFixed(0)} per healer kill, lethal saves ${avg(vals.map((v) => v.lethalPerMin)).toFixed(2)}/min`);
