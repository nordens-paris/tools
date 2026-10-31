import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

import { tbcNames } from '../server/analysis/healer/data.ts';
import { iconByTalents } from '../server/analysis/raidAudit.ts';
import { detectConsumes } from '../server/data/consumes.ts';
import { enchantable } from '../server/data/db.ts';
import { WclClient, pruneCache } from '../server/wcl/client.ts';
import type { WclEvent, WclFightsResponse } from '../server/wcl/types.ts';
import { csvText } from '../web/src/csv.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
});
const code = () => `t${Math.random().toString(36).slice(2).padEnd(15, '0')}`.slice(0, 16);
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

test('a fight list saved during the raid is fetched again the next day', async () => {
  const end = Date.now();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return respond(200, { fights: [], friendlies: [], lang: 'en', start: end - 1000, end });
  }) as typeof fetch;
  const report = code();
  const client = new WclClient('k'.repeat(32), 'example.test');
  await client.fights(report);
  mock.timers.enable({ apis: ['Date'], now: end + 13 * 60 * 60 * 1000 });
  await client.fights(report);
  assert.equal(calls, 2);
});

test('a refused request says what Warcraft Logs said', async () => {
  globalThis.fetch = (async () => respond(403, { error: 'This report is private.' })) as typeof fetch;
  const client = new WclClient('j'.repeat(32), 'example.test');
  await assert.rejects(client.fights(code()), /This report is private/);
});

test('a long rate limit fails at once, with the wait', async () => {
  globalThis.fetch = (async () => new Response('', { status: 429, headers: { 'retry-after': '900' } })) as typeof fetch;
  const client = new WclClient('i'.repeat(32), 'example.test');
  await assert.rejects(client.fights(code()), /rate limiting report\/fights requests for another 15 min/);
});

test('pruneCache runs without a cache folder or with one under the limit', async () => {
  await pruneCache();
});

test('non-English logs get TBC spell names back', () => {
  const fights = { lang: 'ko' } as WclFightsResponse;
  const events = [{ ability: { guid: 12292, name: 'Bloodbath' } }] as unknown as WclEvent[];
  const auras = { auras: [{ guid: 12292, name: 'Bloodbath' }] };
  tbcNames(fights, [events], [auras]);
  assert.equal(events[0].ability!.name, 'Death Wish');
  assert.equal(auras.auras[0].name, 'Death Wish');
  const english = [{ ability: { guid: 12292, name: 'Unchanged' } }] as unknown as WclEvent[];
  tbcNames({ lang: 'en' } as WclFightsResponse, [english]);
  assert.equal(english[0].ability!.name, 'Unchanged');
});

test('every potion counts, simmed or not', () => {
  const found = detectConsumes({ buffs: [], casts: [{ id: 38929, name: 'Fel Mana' }, { id: 22729, name: 'Something' }] }).list;
  assert.deepEqual(found.map((c) => [c.category, c.name, c.simulated]), [['Potion', 'Fel Mana Potion', false], ['Potion', 'Something', false]]);
});

test('both conjured items are kept', () => {
  const found = detectConsumes({ buffs: [], casts: [{ id: 1, name: 'Flame Cap' }, { id: 2, name: 'Dark Rune' }] });
  assert.deepEqual(found.conjuredIds, [22788, 12662]);
});

test('a bare class icon takes its role from the talents', () => {
  const info = (points: number[]) => ({ talents: points.map((id) => ({ id })) }) as never;
  assert.equal(iconByTalents('Priest', info([40, 21, 0])), 'Priest-Discipline');
  assert.equal(iconByTalents('Paladin', info([0, 11, 50])), 'Paladin-Retribution');
  assert.equal(iconByTalents('Mage-Arcane', info([0, 0, 61])), 'Mage-Arcane');
  assert.equal(iconByTalents('Priest'), 'Priest');
});

test('only slots people enchant count', () => {
  assert.equal(enchantable('Head', 1), true);
  assert.equal(enchantable('Neck', 1), false);
});

test('CSV uses semicolons and decimal commas, and quotes what needs it', () => {
  assert.equal(csvText([['a;b', 1.25, undefined, 'x']]), '﻿"a;b";1,3;;x');
});
