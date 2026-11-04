import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bossHpTimeline, chooseAlignment, markSharedGaps, shareGaps, type BossHpPoint, type CollectedGaps, type GapPlayer } from '../server/analysis/gaps.ts';

/** Boss health falling evenly from 100% to 0% over the kill, one point per second. */
const linearHp = (durationSec: number, boss = 'Boss'): BossHpPoint[] =>
  Array.from({ length: durationSec + 1 }, (_, t) => ({ t, boss, pct: 100 - (t / durationSec) * 100 }));

const player = (durationSec: number, gaps: [number, number][], hp = linearHp(durationSec)): GapPlayer => ({
  durationSec,
  gaps: gaps.map(([start, duration]) => ({ start, duration })),
  bossHp: hp,
});

test('gaps at the same boss health are shared, even at different seconds', () => {
  // You: a 200 s kill, gaps at 50% (100 s) and at 80% (40 s). The group kills in 100 s and all
  // stand still at 50% (50 s); nobody else has a gap at 80%.
  const you = player(200, [[100, 4], [40, 3]]);
  const group = [player(100, [[50, 2]]), player(100, [[49, 3]]), player(100, [[51, 2], [10, 1]])];
  const r = shareGaps(you, group, 'hp');
  assert.equal(r.compared, 3);
  assert.equal(r.gaps[0].sharedBy, 3);
  assert.equal(r.gaps[1].sharedBy, 0);
  assert.equal(r.sharedSec, 4);
  assert.equal(r.avoidableSec, 3);
  assert.equal(r.gaps[0].bossHpStart, 50);
  assert.equal(r.gaps[0].bossHpEnd, 48);
  // By the clock, none of them line up.
  assert.equal(shareGaps(you, group, 'time').avoidableSec, 7);
});

test('shared needs at least half of the group', () => {
  const you = player(100, [[50, 2]]);
  const withGap = player(100, [[50, 2]]);
  const without = player(100, []);
  assert.equal(shareGaps(you, [withGap, without, without, without], 'hp').avoidableSec, 2);
  assert.equal(shareGaps(you, [withGap, withGap, without, without], 'hp').sharedSec, 2);
});

test('the alignment that lines up more of the group is chosen', () => {
  // Same health, different kill lengths: health lines them up, the clock doesn't.
  const byHp = [player(100, [[50, 2]]), player(150, [[75, 2]]), player(200, [[100, 2]])];
  assert.equal(chooseAlignment(byHp), 'hp');
  // A timer mechanic at 60 s whatever the boss's health: the clock lines them up.
  const byTime = [player(100, [[60, 3]]), player(150, [[60, 3]]), player(200, [[60, 3]])];
  assert.equal(chooseAlignment(byTime), 'time');
  // Too few players with boss health: by the clock.
  assert.equal(chooseAlignment([player(100, [[50, 2]]), player(100, [[50, 2]], [])]), 'time');
});

test('a gap across a boss change matches the end of one boss and the start of the next', () => {
  const hp = (killAt: number, end: number): BossHpPoint[] => [
    ...linearHp(killAt, 'Essence of Suffering'),
    ...Array.from({ length: end - killAt - 9 }, (_, i) => ({ t: killAt + 10 + i, boss: 'Essence of Desire', pct: 100 - i })),
  ];
  const you = player(200, [[100, 10]], hp(100, 200));
  const other = player(180, [[80, 10]], hp(80, 180));
  assert.equal(shareGaps(you, [other], 'hp').sharedSec, 10);
});

test('without boss health in your hits, gaps line up by the clock', () => {
  const you = player(100, [[60, 3]], []);
  const r = shareGaps(you, [player(100, [[61, 2]]), player(100, [[59, 2]])], 'hp');
  assert.equal(r.align, 'time');
  assert.equal(r.sharedSec, 3);
});

test('boss health is a ratio with maxHitPoints, a percent without it, or scaled by the most seen', () => {
  const bosses = new Map([[5, 'Boss']]);
  const ev = (ms: number, hitPoints: number, maxHitPoints?: number) => ({ timestamp: ms, type: 'damage', targetID: 5, resourceActor: 2, hitPoints, maxHitPoints });
  assert.deepEqual(bossHpTimeline([ev(1000, 2_000_000, 4_000_000)], bosses, 0).map((p) => p.pct), [50]);
  assert.deepEqual(bossHpTimeline([ev(1000, 62)], bosses, 0).map((p) => p.pct), [62]);
  assert.deepEqual(bossHpTimeline([ev(1000, 400_000), ev(2000, 100_000)], bosses, 0).map((p) => p.pct), [100, 25]);
  // One point per second (the last hit), and only on bosses, not adds or the player's own health.
  const thin = bossHpTimeline([ev(1100, 90), ev(1900, 80), { ...ev(2500, 70), targetID: 9 }, { ...ev(3000, 60), resourceActor: 1 }], bosses, 0);
  assert.deepEqual(thin, [{ t: 1.9, boss: 'Boss', pct: 80 }]);
});

test('markSharedGaps sets idleShare and the cost at the DPS while casting', () => {
  const collected = (p: GapPlayer, dps: number): CollectedGaps => {
    const idle = p.gaps.reduce((s, g) => s + g.duration, 0);
    return { fight: { durationSec: p.durationSec, dps, idleSec: idle, gaps: [...p.gaps].sort((a, b) => b.duration - a.duration) }, allGaps: p.gaps, bossHp: p.bossHp };
  };
  // You: 100 s, 10 s idle; 5 s of it at the group's shared 50% mechanic, 5 s alone.
  const you = collected(player(100, [[50, 5], [20, 5]]), 900);
  const top = [collected(player(100, [[50, 4]]), 1000), collected(player(120, [[60, 4]]), 1000), collected(player(80, [[40, 4]]), 1000)];
  markSharedGaps(you, top, true);
  assert.equal(you.fight.idleShare?.align, 'hp');
  assert.equal(you.fight.idleShare?.avoidableSec, 5);
  // 5 s at 900 DPS over 90 busy seconds: 900 × 100 / 90 while casting, × 5 / 100 of the kill.
  assert.equal(you.fight.idleShare?.avoidableDps, 50);
  assert.equal(you.fight.gaps.find((g) => g.start === 50)?.sharedBy, 3);
  // Each top player against the rest: their one gap is shared by both others.
  assert.equal(top[0].fight.idleShare?.avoidableSec, 0);
  assert.equal(top[0].fight.idleShare?.compared, 2);
  // Melee keep swinging through a gap: no DPS estimate.
  markSharedGaps(you, top, false);
  assert.equal(you.fight.idleShare?.avoidableDps, undefined);
});

test('bosses are told apart by key, so a localized log lines up when keyed by NPC ID', () => {
  // The same Reliquary transition in an English and a Chinese log, both keyed "npc:…".
  const hp = (killAt: number): BossHpPoint[] => [
    ...linearHp(killAt, 'npc:23418'),
    ...Array.from({ length: 50 }, (_, i) => ({ t: killAt + 10 + i, boss: 'npc:23419', pct: 100 - i })),
  ];
  const you = player(200, [[100, 10]], hp(100));
  assert.equal(shareGaps(you, [player(180, [[80, 10]], hp(80))], 'hp').sharedSec, 10);
  // Keyed by localized names instead, nothing matches.
  const zh = hp(80).map((p) => ({ ...p, boss: p.boss === 'npc:23418' ? '苦痛精华' : '欲望精华' }));
  assert.equal(shareGaps(you, [player(180, [[80, 10]], zh)], 'hp').sharedSec, 0);
});
