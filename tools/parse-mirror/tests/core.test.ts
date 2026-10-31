import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import type { HealerFightData } from '../server/analysis/healer/data.ts';
import { FightModel } from '../server/analysis/healer/model.ts';
import { BrowserSims } from '../server/sim/browser.ts';
import { buildEnvironment, withConsumablesFrom } from '../server/sim/environment.ts';
import { unlessOutage } from '../server/wcl/reader.ts';
import { parseLogUrl } from '../web/src/api.ts';
import { parseRoute, routeUrl } from '../web/src/route.ts';

const CODE = 'abcdABCD12345678';

test('unlessOutage falls back on one bad report, not on an outage', async () => {
  assert.equal(await Promise.reject(new Error('Warcraft Logs parses/character failed (400)')).catch(unlessOutage('skip')), 'skip');
  for (const message of ['Warcraft Logs is rate limiting parses/character requests', 'failed (429)', "Couldn't reach Warcraft Logs."]) {
    await assert.rejects(Promise.reject(new Error(message)).catch(unlessOutage('skip')));
  }
});

test('only a hunter dying at full HP counts as Feign Death', () => {
  const player = (id: number, icon: string) => ({ id, name: `P${id}`, icon, type: icon.split('-')[0], fights: [{ id: 1 }] });
  const data = {
    report: CODE,
    fight: { id: 1, name: 'Boss', start_time: 0, end_time: 60_000, boss: 1 },
    players: [player(1, 'Hunter-Survival'), player(2, 'Priest-Holy')],
    healing: [],
    damage: [],
    casts: [],
    buffs: [],
    deaths: [
      { timestamp: 10_000, type: 'death', targetID: 1 },
      { timestamp: 20_000, type: 'death', targetID: 2 },
    ],
    resources: [],
    combatants: [],
    healingDone: [],
    meleeTaken: [],
  } as unknown as HealerFightData;
  const model = new FightModel(data);
  assert.deepEqual(model.deaths(), [{ id: 2, t: 20_000 }]);
  assert.equal(model.alive(1, 30_000), true);
  assert.equal(model.alive(2, 30_000), false);
});

test('BrowserSims hands jobs on once the browser holding them has left', async () => {
  const sims = new BrowserSims();
  void sims.run({ sim: 1 });
  const notDone = () => false;
  const first = await sims.take(0, notDone, 'a');
  assert.equal(first.length, 1);
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  try {
    assert.deepEqual(await sims.take(0, notDone, 'b'), []);
    mock.timers.tick(21_000);
    assert.equal((await sims.take(0, notDone, 'b'))[0]?.id, first[0].id);
  } finally {
    mock.timers.reset();
  }
});

test('log links', () => {
  const url = `https://fresh.warcraftlogs.com/reports/${CODE}`;
  assert.deepEqual(parseLogUrl(`${url}#fight=12&source=3`), { report: CODE, fight: 12, lastFight: undefined, source: 3 });
  assert.equal(parseLogUrl(`${url}#fight=last&source=3`).lastFight, true);
  assert.equal(parseLogUrl('https://example.com').report, undefined);
});

test('routes survive a round trip', () => {
  const routes = [
    { view: 'guild', report: CODE },
    { view: 'raid', report: CODE, source: 3 },
    { view: 'progress', report: CODE, source: 3 },
  ] as const;
  for (const r of routes) assert.deepEqual(parseRoute(routeUrl(r).slice(1)), r);
  assert.deepEqual(parseRoute('?r=bad'), { view: 'home' });
});

test('a bare class icon needs healer talents to count as a healer', () => {
  const data = {
    report: CODE,
    fight: { id: 1, name: 'Boss', start_time: 0, end_time: 60_000, boss: 1 },
    players: [
      { id: 1, name: 'Ret', icon: 'Paladin', type: 'Paladin', fights: [{ id: 1 }] },
      { id: 2, name: 'Holy', icon: 'Paladin', type: 'Paladin', fights: [{ id: 1 }] },
    ],
    healing: [
      { timestamp: 1, type: 'heal', sourceID: 1, targetID: 2, amount: 100, ability: { guid: 1, name: 'Flash of Light' } },
      { timestamp: 2, type: 'heal', sourceID: 2, targetID: 1, amount: 100, ability: { guid: 2, name: 'Holy Light' } },
    ],
    damage: [],
    casts: [],
    buffs: [],
    deaths: [],
    resources: [],
    combatants: [
      { sourceID: 1, talents: [{ id: 0 }, { id: 11 }, { id: 50 }] },
      { sourceID: 2, talents: [{ id: 50 }, { id: 11 }, { id: 0 }] },
    ],
    healingDone: [],
    meleeTaken: [],
  } as unknown as HealerFightData;
  const model = new FightModel(data);
  assert.deepEqual([...model.healers.keys()], [2]);
  assert.equal(model.minorHealers.size, 0);
});

test('no compared players leaves the consumes environment alone', () => {
  const env = buildEnvironment([], []);
  assert.deepEqual(withConsumablesFrom(env, [], 100), env);
});
