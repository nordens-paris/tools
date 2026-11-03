import assert from 'node:assert/strict';
import { test } from 'node:test';

import { gapParts, simScale } from '../shared/dpsGap.ts';
import type { SimPlayerResult } from '../shared/types.ts';

const player = (rank: number | undefined, actualDps: number, simDps: number, luckDps: number, simDpsOnYourTime = simDps) =>
  ({ name: `p${rank ?? 'you'}`, rank, actualDps, simDps, simDpsOnYourTime, luck: { luckDps } }) as SimPlayerResult;

test('the four parts add up to the real difference', () => {
  const you = player(undefined, 1400, 1500, -20);
  const rows = [you, player(1, 1900, 1700, 120, 1650), player(2, 1750, 1600, 60, 1580), player(3, 1800, 1750, 90, 1700)];
  const k = simScale(rows);
  for (const e of rows.filter((r) => r.rank)) {
    const sum = Object.values(gapParts(e, you, k)).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - (e.actualDps - you.actualDps)) < 1e-9);
  }
});

test('a sim that reads high for everyone is not play', () => {
  // Everyone plays exactly to their setup, and the sim says 5% more than anyone can do.
  const at = (rank: number | undefined, real: number, luck: number) => player(rank, real + luck, real / 0.95, luck);
  const you = at(undefined, 1400, 0);
  const rows = [you, at(1, 1800, 100), at(2, 1700, 50), at(3, 1650, 80)];
  const k = simScale(rows);
  assert.ok(Math.abs(k - 0.95) < 1e-9);
  for (const e of rows.filter((r) => r.rank)) assert.ok(Math.abs(gapParts(e, you, k).play) < 1e-9);
});

test('no top players leaves the sim unscaled', () => {
  assert.equal(simScale([player(undefined, 1400, 1500, 0)]), 1);
});
