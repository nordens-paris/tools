import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildEnvironment, withTopRaidBuffs, type DebuffWindow } from '../server/sim/environment.ts';
import type { AuraUptime } from '../shared/types.ts';

const debuff = (name: string, bands?: [number, number][], uptimePct = bands ? bands.reduce((s, [a, b]) => s + b - a, 0) : 100): AuraUptime => ({
  id: 1,
  name,
  uptimePct,
  uses: 1,
  bands,
});
const windows = (env: ReturnType<typeof buildEnvironment>) => (env.debuffs.uptimeWindows as DebuffWindow[] | undefined) ?? [];

test('a debuff up part of the fight gets its windows, merged across refreshes', () => {
  // 100 s fight: up 10-40 s, refreshed with a 0.5 s gap, then 60-100 s.
  const env = buildEnvironment([], [debuff('Curse of the Elements', [[10, 40], [40.5, 50], [60, 100]])], undefined, { durationSec: 100 });
  assert.ok(env.debuffs.curseOfElements);
  assert.deepEqual(windows(env), [
    { debuff: 'curseOfElements', start: 0.1, end: 0.5 },
    { debuff: 'curseOfElements', start: 0.6, end: 1 },
  ]);
  assert.ok(env.detected.includes('Curse of the Elements (80%)'));
});

test('a debuff up all fight, or one without bands, has no windows', () => {
  const full = buildEnvironment([], [debuff('Sunder Armor', [[0.2, 100]])], undefined, { durationSec: 100 });
  assert.ok(full.debuffs.sunderArmor);
  assert.equal(windows(full).length, 0);
  // Older saved results: 40% or more counts for all fight, less not at all.
  const old = buildEnvironment([], [debuff('Misery', undefined, 60), debuff('Faerie Fire', undefined, 30)], undefined, { durationSec: 100 });
  assert.ok(old.debuffs.misery);
  assert.equal(old.debuffs.faerieFire, undefined);
  assert.equal(windows(old).length, 0);
});

test('with bands, a debuff under 40% still counts for its windows', () => {
  const env = buildEnvironment([], [debuff('Faerie Fire', [[70, 100]])], undefined, { durationSec: 100 });
  assert.ok(env.debuffs.faerieFire);
  assert.deepEqual(windows(env), [{ debuff: 'faerieFire', start: 0.7, end: 1 }]);
});

test('top raid buffs raise a debuff to the median top uptime, with that player\'s windows', () => {
  const mine = buildEnvironment([], [debuff('Curse of the Elements', [[50, 100]])], undefined, { durationSec: 100 });
  const top = [[[5, 100]], [[20, 100]], [[30, 100]]].map((b) =>
    buildEnvironment([], [debuff('Curse of the Elements', b as [number, number][])], undefined, { durationSec: 100 }),
  );
  const { env, added } = withTopRaidBuffs(mine, top);
  assert.deepEqual(windows(env), [{ debuff: 'curseOfElements', start: 0.2, end: 1 }]);
  assert.deepEqual(added, ['Curse of the Elements 50% → 80%']);
  // Never lower than yours.
  assert.deepEqual(windows(withTopRaidBuffs(top[0], [mine]).env), windows(top[0]));
});
