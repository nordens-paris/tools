import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { outcomeOn } from '../server/analysis/collect.ts';
import type { HealerFightData } from '../server/analysis/healer/data.ts';
import { healerDeaths } from '../server/analysis/healer/metrics.ts';
import { FightModel } from '../server/analysis/healer/model.ts';
import { gearIssues } from '../server/analysis/raidAudit.ts';
import type { PlayerFightRaw } from '../server/analysis/collect.ts';
import { computeLuck } from '../server/sim/luck.ts';
import type { SimPlayerMetrics } from '../server/sim/runner.ts';
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

test('a tank under 50% for longer than the 8 s looked at died with time to save them', () => {
  const tank = { id: 1, name: 'Tank', icon: 'Warrior-Protection', type: 'Warrior', fights: [{ id: 1 }] };
  const hit = (sec: number, hitPoints: number) => ({ timestamp: sec * 1000, type: 'damage', sourceID: 99, targetID: 1, amount: 3000, ability: { name: 'Melee', guid: 1 }, resourceActor: 2, hitPoints });
  const data = {
    report: CODE,
    fight: { id: 1, name: 'Boss', start_time: 0, end_time: 60_000, boss: 1, kill: true },
    players: [tank],
    healing: [],
    damage: [hit(5, 40), ...Array.from({ length: 12 }, (_, i) => hit(6 + i, 30 + (i % 3) * 5)), hit(18, 0)],
    casts: [],
    buffs: [],
    deaths: [{ timestamp: 18_000, type: 'death', targetID: 1 }],
    resources: [],
    combatants: [],
    healingDone: [],
    meleeTaken: [],
  } as unknown as HealerFightData;
  const [death] = healerDeaths(new FightModel(data));
  assert.equal(death.kind, 'window');
  assert.ok((death.secBelow50 ?? 0) >= 8);
});

test('luck outcomes count only the hits on the boss', () => {
  const ev = (targetID: number, hitType: number, amount: number) => ({ timestamp: 0, type: 'damage', sourceID: 1, targetID, hitType, amount, ability: { name: 'Shadow Bolt', guid: 27209 } });
  const events = [ev(10, 1, 1000), ev(10, 2, 2000), ev(10, 16, 750), ev(10, 14, 0), ev(20, 2, 2000), ev(20, 2, 2000), ev(20, 0, 0)];
  const table = { name: 'Shadow Bolt', total: 9750, landed: 5, crits: 3, avoided: 2, normalAvg: 875, critAvg: 2000 };
  const o = outcomeOn(table, events, new Set([10]));
  assert.deepEqual({ total: o.total, landed: o.landed, crits: o.crits, avoided: o.avoided, normalAvg: o.normalAvg, critAvg: o.critAvg }, { total: 3750, landed: 3, crits: 1, avoided: 1, normalAvg: 875, critAvg: 2000 });
  // No events for the ability, or no boss: the table's outcome stays.
  assert.equal(outcomeOn(table, [], new Set([10])), table);
  assert.equal(outcomeOn(table, events, new Set()), table);
});

test("an Elemental's own Totem of Wrath counts once in the raid hit check", () => {
  // Standard Elemental talents give 12% (Elemental Precision, Nature's Guidance, Totem of Wrath); 2% from rating.
  const info = { sourceID: 1, gear: [], auras: [], talents: [{ id: 41 }, { id: 0 }, { id: 20 }], hitSpell: 25.24 } as unknown as Parameters<typeof gearIssues>[1];
  const hit = gearIssues('Shaman-Elemental', info, true).find((i) => i.kind === 'hit');
  assert.equal(hit?.text, 'Hit 14.0% of 16%');
});

test("a spell with no crits in the log is valued at the sim's crit bonus", () => {
  // The sim's Shadow Bolt crits for 1.5x (3000 vs 2000); the log had 10 hits of 2000 and no crits.
  const sim = { actions: [{ id: { spellId: 27209 }, targets: [{ hits: 8, crits: 2, damage: 22000, critDamage: 6000, tickDamage: 0 }] }], auras: [] } as unknown as SimPlayerMetrics;
  const raw = {
    fight: { durationSec: 100, simComparableDps: 200 },
    outcomes: [{ name: 'Shadow Bolt', total: 20000, landed: 10, crits: 0, avoided: 0, normalAvg: 2000, critAvg: 0 }],
  } as unknown as PlayerFightRaw;
  // 2 crits expected, each worth 1000 more than a hit: 2000 damage over 100 s.
  assert.equal(computeLuck(raw, sim).critDps, -20);
});

test('max HP without big hits comes from the class base health and stamina', () => {
  const data = {
    report: CODE,
    fight: { id: 1, name: 'Boss', start_time: 0, end_time: 60_000, boss: 1 },
    players: [{ id: 1, name: 'Mage', icon: 'Mage-Arcane', type: 'Mage', fights: [{ id: 1 }] }],
    healing: [],
    damage: [],
    casts: [],
    buffs: [],
    deaths: [],
    resources: [],
    combatants: [{ sourceID: 1, stamina: 500 }],
    healingDone: [],
    meleeTaken: [],
  } as unknown as HealerFightData;
  // 3213 base + 20 for the first 20 stamina + 10 for each of the other 480.
  assert.deepEqual(new FightModel(data).maxHp(1), { value: 8033, from: 'stamina' });
});
