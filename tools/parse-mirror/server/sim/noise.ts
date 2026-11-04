// How much of a sim number, or of a difference between two sims, is the sims' own noise.
// Every sim runs with randomSeed 1, so iteration i of two sims starts from the same random numbers:
// subtracting them iteration by iteration cancels most of the shared noise. WoWSims' own stat
// weights do the same (core/statweight.go). Needs every iteration's DPS (SimDps.values).

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Standard error of a sim's average DPS: the spread over iterations ÷ √iterations. */
export function meanSe(values?: number[]): number | undefined {
  return values && values.length > 1 ? sd(values) / Math.sqrt(values.length) : undefined;
}

/**
 * Standard error of b's average minus a's, paired by iteration. Undefined without every
 * iteration's DPS from both, or when their iteration counts differ.
 */
export function pairedSe(a?: number[], b?: number[]): number | undefined {
  if (!a || !b || a.length !== b.length || a.length < 2) return undefined;
  return sd(b.map((v, i) => v - a[i])) / Math.sqrt(a.length);
}

/**
 * The sims' own noise in the tiles' group averages, from every iteration's DPS: per iteration, the
 * group's average difference to you (gear: their setup on your kill time − yours; kill: their own
 * kill time − your kill time; play: their own sim − yours), then its standard error. Paired by
 * iteration like pairedSe, so noise the sims share cancels. Undefined if any sim lacks its values.
 */
export function groupGapSe(you: number[] | undefined, group: { own?: number[]; onYourTime?: number[] }[]): { gearSe: number; killSe: number; playSe: number } | undefined {
  const n = you?.length ?? 0;
  if (!you || n < 2 || !group.length || group.some((g) => g.own?.length !== n || g.onYourTime?.length !== n)) return undefined;
  const per = (f: (g: (typeof group)[number], i: number) => number) => Array.from({ length: n }, (_, i) => group.reduce((s, g) => s + f(g, i), 0) / group.length);
  const se = (xs: number[]) => sd(xs) / Math.sqrt(n);
  return {
    gearSe: se(per((g, i) => g.onYourTime![i] - you[i])),
    killSe: se(per((g, i) => g.own![i] - g.onYourTime![i])),
    playSe: se(per((g, i) => g.own![i] - you[i])),
  };
}
