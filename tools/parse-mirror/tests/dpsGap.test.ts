import assert from 'node:assert/strict';
import { test } from 'node:test';

import { biggestAbilityGap, gapNoise, gapParts, playByAbility, simScale } from '../shared/dpsGap.ts';
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

const withAbilities = (p: SimPlayerResult, abilities: NonNullable<SimPlayerResult['abilities']>, durationSec = 120) => ({ ...p, durationSec, abilities });

test('play by ability and the other row add up to the Play tile', () => {
  const you = withAbilities(player(undefined, 1400, 1500, -20), [
    { name: 'Shadow Bolt', realDps: 1100, simDps: 1200, casts: 50, simCasts: 55, luckDps: -15 },
    { name: 'Corruption', realDps: 200, simDps: 210, casts: 6, simCasts: 6, luckDps: 0 },
    { name: 'Tiny', realDps: 5, simDps: 5, casts: 1, simCasts: 1, luckDps: 0 },
  ]);
  const top = [
    withAbilities(player(1, 1900, 1700, 120, 1650), [
      { name: 'Shadow Bolt', realDps: 1500, simDps: 1350, casts: 70, simCasts: 66, luckDps: 100 },
      { name: 'Curse of Doom', realDps: 300, simDps: 250, casts: 2, simCasts: 2, luckDps: 0 },
    ]),
    withAbilities(player(2, 1750, 1600, 60, 1580), [{ name: 'Shadow Bolt', realDps: 1400, simDps: 1300, casts: 64, simCasts: 62, luckDps: 50 }]),
  ];
  const rows = [you, ...top];
  const k = simScale(rows);
  const t = playByAbility(rows, you, k)!;
  const tilePlay = top.reduce((s, e) => s + gapParts(e, you, k).play, 0) / top.length;
  const sum = t.rows.reduce((s, r) => s + r.gap, 0) + t.other.gap;
  assert.ok(Math.abs(sum - tilePlay) < 1e-9);
  assert.ok(Math.abs(t.total.gap - tilePlay) < 1e-9);
  // Under 2% of everyone's DPS: folded into other.
  assert.ok(!t.rows.some((r) => r.name === 'Tiny'));
  assert.deepEqual(t.other.names, ['Tiny']);
  // Your casts part and per-cast part add up to your real − luck − sim on the ability.
  for (const r of t.rows.filter((x) => x.castsPart !== undefined)) assert.ok(Math.abs(r.castsPart! + r.perCastPart! - (r.realDps - r.luckDps - r.simDps)) < 1e-9);
  // Curse of Doom: only one top player used it, so the group's average play on it is half theirs.
  // Their 20 DPS of luck not on any ability is shared out by damage: 300 of 1800.
  const cod = t.rows.find((r) => r.name === 'Curse of Doom')!;
  assert.ok(Math.abs(cod.groupPlay - (300 - (20 * 300) / 1800 - k * 250) / 2) < 1e-9);
  assert.equal(cod.castsPart, undefined);
  // Shares of the sim: only that player's, since your sim doesn't use it.
  assert.equal(cod.castsPct, undefined);
  assert.equal(cod.groupCastsPct, 1);
});

test('a cast that matches the sim is no play, and knock-on and proc luck comes off the abilities', () => {
  // Everything is on the two abilities; 60 of the 100 DPS luck is procs and knock-on, not direct.
  const you = withAbilities(player(undefined, 2600, 2400, 100), [
    { name: 'Shadow Bolt', realDps: 2500, simDps: 2290, casts: 48, simCasts: 48, luckDps: 40 },
    { name: 'Curse of Doom', realDps: 100, simDps: 110, casts: 1, simCasts: 1, luckDps: 0 },
  ]);
  const top = withAbilities(player(1, 3000, 2900, 200), [{ name: 'Shadow Bolt', realDps: 3000, simDps: 2900, casts: 60, simCasts: 60, luckDps: 200 }]);
  const rows = [you, top];
  const k = simScale(rows);
  assert.ok(k < 1);
  const t = playByAbility(rows, you, k)!;
  const sb = t.rows.find((r) => r.name === 'Shadow Bolt')!;
  const cod = t.rows.find((r) => r.name === 'Curse of Doom')!;
  // 2500 / 2600 of the 60 spread luck lands on Shadow Bolt.
  assert.ok(Math.abs(sb.luckDps - (40 + (60 * 2500) / 2600)) < 1e-9);
  // One cast against the sim's one: nothing from casts, despite k, and 100% of the sim's casts.
  assert.equal(cod.castsPart, 0);
  assert.equal(cod.castsPct, 1);
  assert.ok(Math.abs(cod.perCastPct! - (100 - (60 * 100) / 2600) / 110) < 1e-9);
  assert.ok(Math.abs(sb.perCastPct! - (2500 - sb.luckDps) / 2290) < 1e-9);
  // Overall: casts × per cast = real − luck over the sim, on the abilities the sim uses.
  const o = t.overall;
  assert.ok(Math.abs(o.casts.you! - 1) < 1e-9);
  assert.ok(Math.abs(o.casts.you! * o.perCast.you! - (2600 - 100) / 2400) < 1e-9);
  assert.deepEqual(o.perCast.range, [o.perCast.group, o.perCast.group]);
  // All luck is on the abilities, so other is empty.
  assert.ok(Math.abs(t.other.play) < 1e-9);
});

test('the gap noise is only what is measured with noise: the sims and the luck estimates', () => {
  const luck = (luckDps: number, estimateSeDps: number) => ({ luckDps, estimateSeDps }) as SimPlayerResult['luck'];
  const you = { ...player(undefined, 1400, 1500, -20), luck: luck(-20, 4), noise: { simSe: 3, gearSe: 0, killSe: 0 } };
  const same = [1, 2, 3, 4].map((r) => ({ ...player(r, 1800, 1700, 50, 1650), luck: luck(50, 3), noise: { simSe: 3, gearSe: 1, killSe: 2 } }));
  const k = simScale([you, ...same]);
  // Without the server's group noise: the conservative bound from each player's standard errors.
  const bound = gapNoise([you, ...same], you);
  assert.ok(Math.abs(bound.parts.gear.se - k * 1) < 1e-9);
  assert.ok(Math.abs(bound.parts.kill.se - k * 2) < 1e-9);
  assert.ok(Math.abs(bound.parts.luck.se - 5) < 1e-9);
  assert.ok(Math.abs(bound.parts.play.se - Math.hypot(k * 6, 5)) < 1e-9);
  // With it, that's used instead.
  const exact = { ...you, noise: { ...you.noise, group: { gearSe: 0.5, killSe: 0.7, playSe: 2 } } };
  const n = gapNoise([exact, ...same], exact);
  assert.ok(Math.abs(n.parts.gear.se - k * 0.5) < 1e-9);
  assert.ok(Math.abs(n.parts.play.se - Math.hypot(k * 2, 5)) < 1e-9);
  // Top players who differ a lot from each other don't widen it: they are the comparison.
  const spread = [1, 2, 3, 4].map((r) => ({ ...player(r, 1600 + r * 100, 1700, r * 30, 1650), luck: luck(r * 30, 3), noise: { simSe: 3, gearSe: 1, killSe: 2 } }));
  assert.ok(Math.abs(gapNoise([you, ...spread], you).parts.luck.se - 5) < 1e-9);
});

test('the biggest ability gap says why only when that part matters', () => {
  const row = { name: 'Heroic Strike', realDps: 0, simDps: 0, luckDps: 0, play: 0, groupPlay: 200, gap: 200 };
  const you = player(undefined, 3000, 3000, 0);
  const t = (r: object) => ({ overall: { casts: {}, perCast: {} }, rows: [{ ...row, ...r }], other: { play: 0, groupPlay: 0, gap: 0, names: [] }, total: { play: 0, groupPlay: 0, gap: 0 } });
  assert.equal(biggestAbilityGap(t({ castsPart: -120, perCastPart: -10 }), you)?.reason, 'casts');
  assert.equal(biggestAbilityGap(t({ castsPart: 20, perCastPart: -80 }), you)?.reason, 'perCast');
  // A 1 DPS per-cast loss doesn't explain a 200 DPS gap.
  assert.equal(biggestAbilityGap(t({ castsPart: 20, perCastPart: -1 }), you)?.reason, 'group');
  // Under 3% of your DPS: no finding.
  assert.equal(biggestAbilityGap(t({ gap: 50 }), you), undefined);
});
