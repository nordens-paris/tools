import assert from 'node:assert/strict';
import { test } from 'node:test';

import { healingKept, healingShares, heldBack, scoreInputs, type HealerScoreInputs, type HealerScoreRef } from '../shared/healerScore.ts';
import type { HealerMetrics } from '../shared/types.ts';

const zero = [0, 0, 0, 0, 0];
const percentiles = Array.from({ length: 51 }, (_, i) => i * 2);
// A made-up pool: values read straight as percentiles, HPS 0-2000 as 0-100.
const ref: HealerScoreRef = {
  version: 'test',
  pool: 'test',
  specs: {
    'Holy Priest': {
      healers: 10,
      kills: 10,
      share: 1,
      metrics: {
        hpm: { beta: zero, q: percentiles },
        ownOverheal: { beta: zero, q: percentiles },
        idle: { beta: zero, q: percentiles },
        reaction: { beta: zero, q: percentiles },
        hps: { beta: zero, q: percentiles.map((v) => v * 20) },
      },
    },
  },
  bosses: {},
};

const healer = (name: string, hps: number, extra: Partial<HealerScoreInputs> & { minor?: boolean } = {}) => {
  const weak = hps < 500;
  const { minor, ...inputs } = extra;
  return {
    name,
    minor,
    inputs: {
      spec: 'Holy Priest',
      values: { hpm: weak ? 10 : 80, ownOverheal: weak ? 90 : 20, idle: weak ? 90 : 20, reaction: weak ? 90 : 20, hps },
      dtpsPerHealer: 500,
      healers: 4,
      durationSec: 120,
      tankShare: 0.3,
      activity: 0.8,
      ...inputs,
    } as HealerScoreInputs,
  };
};
const fight = (healers: ReturnType<typeof healer>[]) => ({ encounterId: 1, healers });
const usualOne = () => 1;

test('healingKept counts time under Carrion Swarm, within limits', () => {
  assert.equal(healingKept({ durationSec: 100 }), 1);
  assert.equal(healingKept({ durationSec: 100, carrionSwarmSec: 0 }), 1);
  assert.ok(Math.abs(healingKept({ durationSec: 100, carrionSwarmSec: 50 }) - 0.6) < 1e-9);
  assert.equal(healingKept({ durationSec: 100, carrionSwarmSec: 100 }), 0.25);
  assert.equal(healingKept({ durationSec: 0, carrionSwarmSec: 5 }), 1);
});

test('scoreInputs corrects HPS and healing per mana, not the rest', () => {
  const metrics = {
    hps: 600,
    durationSec: 100,
    carrionSwarmSec: 50,
    effective: 60000,
    absorbed: 0,
    overhealPct: 0,
    overheal: { ownChoice: 0 },
    specLabel: 'Holy Priest',
    mana: { healPerMana: 3 },
    idleWhileNeeded: { sec: 2, ofSec: 10 },
    reaction: { medianSec: 1.5 },
    context: { raidDtps: 1000, raidHealers: 4 },
    tankShare: 0,
    activity: 0.8,
  } as unknown as HealerMetrics;
  const inputs = scoreInputs(metrics);
  assert.ok(Math.abs(inputs.values.hps! - 1000) < 1e-6);
  assert.ok(Math.abs(inputs.values.hpm! - 5) < 1e-6);
  assert.equal(inputs.values.idle, 0.2);
  assert.equal(inputs.carrionSwarmSec, 50);
});

test('minor healers do not raise the others\' shares', () => {
  const without = healingShares([healer('A', 1000), healer('B', 1000)], ref);
  const withMinor = healingShares([healer('A', 1000), healer('B', 1000), healer('C', 10, { minor: true })], ref);
  assert.equal(withMinor.get('A'), without.get('A'));
  assert.ok(withMinor.get('C')! < 0.05);
});

test('heldBack marks a weak healer far under their usual share', () => {
  const held = heldBack(fight([healer('Low', 200), healer('A', 1000), healer('B', 1000), healer('C', 1000)]), usualOne, ref);
  assert.deepEqual(held.map((h) => [h.name, h.why]), [['Low', 'share']]);
});

test('heldBack leaves out Teron ghosts and short fights', () => {
  const others = [healer('A', 1000), healer('B', 1000), healer('C', 1000)];
  assert.deepEqual(heldBack(fight([healer('Low', 200, { ghostSec: 30 }), ...others]), usualOne, ref), []);
  assert.deepEqual(heldBack(fight([healer('Low', 200, { durationSec: 50 }), ...others]), usualOne, ref), []);
});
