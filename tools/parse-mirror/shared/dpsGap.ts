// Splits each top player's real DPS difference to you into gear & buffs, kill time, play and luck.
// The sim's numbers are scaled by how much of their simmed DPS the top players turn into luck-free
// real DPS (their median), so an overall sim bias doesn't show up as play. The parts add up exactly.
import type { SimPlayerResult } from './types.ts';

export const GAP_PARTS = ['gear', 'kill', 'play', 'luck'] as const;
export type GapPart = (typeof GAP_PARTS)[number];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median of (real − luck) / sim DPS over the top players; 1 when there's nothing to go on. */
export function simScale(rows: SimPlayerResult[]): number {
  const ratios = rows.filter((e) => e.rank && e.simDps > 0).map((e) => (e.actualDps - e.luck.luckDps) / e.simDps);
  return ratios.length ? median(ratios) : 1;
}

export function gapParts(e: SimPlayerResult, you: SimPlayerResult, k: number): Record<GapPart, number> {
  // What's left of real DPS after luck and the scaled sim: how well they played their setup.
  const play = (p: SimPlayerResult) => p.actualDps - p.luck.luckDps - k * p.simDps;
  // Older saved results have no sim on your kill time; then kill time stays inside "gear & buffs".
  const onYourTime = e.simDpsOnYourTime ?? e.simDps;
  return {
    gear: k * (onYourTime - you.simDps),
    kill: k * (e.simDps - onYourTime),
    play: play(e) - play(you),
    luck: e.luck.luckDps - you.luck.luckDps,
  };
}
