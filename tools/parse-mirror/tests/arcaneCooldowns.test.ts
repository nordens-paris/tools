import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRequest, type SimPlayerSetup } from '../server/sim/request.ts';
import type { SimEnvironment } from '../server/sim/environment.ts';
import { mageArcane } from '../server/specs/mage-arcane.ts';

const env = { individualBuffs: {}, partyBuffs: {}, raidBuffs: {}, debuffs: {}, bonusStats: {} } as unknown as SimEnvironment;

function delayOf(otherCooldownsSec?: number) {
  const player: SimPlayerSetup = {
    name: 'Mage',
    race: 'RaceTroll',
    gear: [],
    consumes: [],
    flags: {},
    talents: mageArcane.talentPresets[0].talents,
    specOptions: {},
    aplFile: 'mage-arcane.apl.json',
    timing: { cooldowns: [{ spellId: 12042, atSec: 22 }], otherCooldownsSec },
  };
  const req = buildRequest({ spec: mageArcane, player, env, durationSec: 60, encounter: { id: 50618, name: 'Boss' }, iterations: 1 });
  const rotation = (req.raid.parties[0].players[0] as { rotation: { valueVariables: { name: string; value: unknown }[] } }).rotation;
  return rotation.valueVariables.find((v) => v.name === 'Delay Major CDs')!.value;
}

test("the Arcane sim uses potions and trinkets when the player started their cooldowns, not at the APL's 10 s", () => {
  assert.deepEqual(delayOf(22.4), { const: { val: '22.4s' } });
  // Without Arcane Power or a Destruction Potion in the log, the APL's own value stays.
  assert.deepEqual(delayOf(undefined), { const: { val: '10s' } });
});
