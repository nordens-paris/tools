import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { warriorFury } from '../server/specs/warrior-fury.ts';
import type { AplListItem } from '../server/specs/types.ts';

test('the Fury sim executes like top players: Execute above Bloodthirst, Heroic Strike in the execute phase', () => {
  const apl = JSON.parse(readFileSync('data/wowsims/warrior-fury.apl.json', 'utf8')) as { priorityList: AplListItem[] };
  const list = apl.priorityList;
  const at = (id: number) => list.findIndex((i) => i.action.castSpell?.spellId.spellId === id);
  // WoWSims' own order: Bloodthirst, Whirlwind, then Execute.
  assert.ok(at(30335) < at(25236));
  warriorFury.sim.aplEdit!(list);
  assert.ok(at(25236) < at(30335));
  // The single-target Whirlwind (the first one is for several targets).
  assert.ok(at(25236) < list.findLastIndex((i) => i.action.castSpell?.spellId.spellId === 1680));
  const hs = JSON.stringify(list[at(29707)].action.condition);
  assert.ok(!hs.includes('isExecutePhase'));
  assert.ok(hs.includes('currentRage'));
});
