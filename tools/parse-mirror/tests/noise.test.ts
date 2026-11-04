import assert from 'node:assert/strict';
import { test } from 'node:test';

import { abilityRows } from '../server/sim/abilities.ts';
import { computeLuck } from '../server/sim/luck.ts';
import { groupGapSe, meanSe, pairedSe } from '../server/sim/noise.ts';
import type { PlayerFightRaw } from '../server/analysis/collect.ts';
import type { SimPlayerMetrics } from '../server/sim/runner.ts';

const close = (a: number | undefined, b: number, tol = 1e-9) => assert.ok(a !== undefined && Math.abs(a - b) < tol, `${a} ≈ ${b}`);

test('paired standard error uses the per-iteration differences', () => {
  // Sim b is sim a plus 10 DPS plus a little noise of its own: the shared noise cancels.
  const a = [1000, 1200, 900, 1100, 1050, 950];
  const own = [1, -1, 2, -2, 0, 0];
  const b = a.map((v, i) => v + 10 + own[i]);
  const sd = Math.sqrt(own.reduce((s, x) => s + x * x, 0) / (own.length - 1));
  close(pairedSe(a, b), sd / Math.sqrt(a.length));
  // Treated as independent sims the same difference would look far noisier.
  assert.ok(Math.hypot(meanSe(a)!, meanSe(b)!) > 20 * pairedSe(a, b)!);
});

test('no per-iteration values, or different iteration counts, give no standard error', () => {
  assert.equal(pairedSe(undefined, [1, 2]), undefined);
  assert.equal(pairedSe([1, 2, 3], [1, 2]), undefined);
  assert.equal(meanSe([5]), undefined);
});

test('direct luck has a binomial standard error in DPS', () => {
  // The sim crits 25% of its 100 landed hits and misses 5 of 105; crits do 1000 more than a hit.
  const sim = {
    actions: [{ id: { spellId: 27209 }, targets: [{ hits: 75, crits: 25, misses: 5, damage: 175000, critDamage: 75000, tickDamage: 0 }] }],
    auras: [],
  } as unknown as SimPlayerMetrics;
  const raw = {
    fight: { durationSec: 100, simComparableDps: 400 },
    outcomes: [{ name: 'Shadow Bolt', total: 40000, landed: 20, crits: 5, avoided: 0, normalAvg: 1000, critAvg: 2000 }],
  } as unknown as PlayerFightRaw;
  const luck = computeLuck(raw, sim).summary;
  // Crits: 20 landed × 0.25 × 0.75 = 3.75 crits², × 1000² damage, over 100 s.
  close(luck.critSeDps, (Math.sqrt(3.75) * 1000) / 100);
  // Misses: 20 attempts × (5/105) × (100/105), × 2000² (average landed hit), over 100 s.
  const p = 5 / 105;
  close(luck.avoidSeDps, (Math.sqrt(20 * p * (1 - p)) * 2000) / 100);
});

test('ability rows match the log and the sim by name, with casts or hits', () => {
  const sim = {
    actions: [
      // Immolate: the cast with its direct hit (tag 0) and the DoT ticks (tag 1).
      { id: { spellId: 27215, tag: 0 }, targets: [{ casts: 20, hits: 15, crits: 5, damage: 30000 }] },
      { id: { spellId: 27215, tag: 1 }, targets: [{ casts: 0, damage: 20000, tickDamage: 20000 }] },
      // Main- and off-hand white swings.
      { id: { otherId: 'OtherActionAttack', tag: 1 }, targets: [{ hits: 60, misses: 20, damage: 40000 }] },
      { id: { otherId: 'OtherActionAttack', tag: 2 }, targets: [{ hits: 30, misses: 10, damage: 10000 }] },
      // Windfury Totem's extra swings: Melee in the log, and their casts don't make Melee a cast.
      { id: { otherId: 'OtherActionAttack', tag: 25584 }, targets: [{ casts: 10, hits: 10, damage: 10000 }] },
    ],
    auras: [],
  } as unknown as SimPlayerMetrics;
  const raw = {
    fight: { durationSec: 50, casts: [{ name: 'Immolate', casts: 8 }] },
    outcomes: [
      { name: 'Immolate', total: 20000, landed: 8, crits: 2, avoided: 0, normalAvg: 1000, critAvg: 1500 },
      { name: 'Melee', total: 20000, landed: 50, crits: 5, avoided: 10, normalAvg: 400, critAvg: 800 },
    ],
  } as unknown as PlayerFightRaw;
  const luck = { abilities: [{ name: 'Immolate', luckDps: 5 }] } as unknown as Parameters<typeof abilityRows>[3];
  const rows = abilityRows(raw, sim, 2, luck);
  const immolate = rows.find((r) => r.name === 'Immolate')!;
  // Per iteration: 25,000 damage over 50 s, 10 casts.
  close(immolate.simDps, 500);
  close(immolate.simCasts, 10);
  assert.equal(immolate.casts, 8);
  assert.equal(immolate.byHits, undefined);
  assert.equal(immolate.luckDps, 5);
  const melee = rows.find((r) => r.name === 'Melee')!;
  assert.equal(melee.byHits, true);
  assert.equal(melee.casts, 60);
  close(melee.simCasts, 65);
  close(melee.simDps, 600);
});

test('group noise averages the paired differences to you per iteration', () => {
  const you = [1000, 1100, 900, 1050];
  // Two top players whose sims move with yours plus a little of their own.
  const a = { onYourTime: you.map((v, i) => v + 100 + [1, -1, 0, 0][i]), own: you.map((v, i) => v + 150 + [0, 2, -2, 0][i]) };
  const b = { onYourTime: you.map((v, i) => v + 200 + [0, 0, 1, -1][i]), own: you.map((v, i) => v + 260 + [1, 0, 0, -1][i]) };
  const g = groupGapSe(you, [a, b])!;
  const se = (d: number[]) => {
    const m = d.reduce((s, x) => s + x, 0) / d.length;
    return Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (d.length - 1)) / Math.sqrt(d.length);
  };
  close(g.gearSe, se(you.map((v, i) => (a.onYourTime[i] + b.onYourTime[i]) / 2 - v)));
  close(g.killSe, se(you.map((_, i) => (a.own[i] - a.onYourTime[i] + b.own[i] - b.onYourTime[i]) / 2)));
  close(g.playSe, se(you.map((v, i) => (a.own[i] + b.own[i]) / 2 - v)));
  // A sim without its iterations: no group noise.
  assert.equal(groupGapSe(you, [a, { own: b.own }]), undefined);
});
