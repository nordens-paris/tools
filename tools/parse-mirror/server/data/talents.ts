// Reading talent strings against the WoWSims talent trees.
import { loadJson } from './db.ts';

type TalentTrees = { name: string; talents: { name: string; spellIds: number[]; maxPoints: number }[] }[];

/** Points per talent name for a talent string. */
export function talentPoints(className: string, talents: string): Map<string, number> {
  const trees = loadJson<TalentTrees>(`talents/${className.toLowerCase()}.json`);
  const parts = talents.split('-');
  const out = new Map<string, number>();
  trees.forEach((tree, ti) => tree.talents.forEach((t, i) => out.set(t.name, Number(parts[ti]?.[i] ?? 0))));
  return out;
}

/** Points in a named talent, e.g. talentRank('Warlock', talents, 'Demonic Sacrifice'). */
export function talentRank(className: string, talents: string, talentName: string): number {
  const trees = loadJson<TalentTrees>(`talents/${className.toLowerCase()}.json`);
  const parts = talents.split('-');
  for (const [ti, tree] of trees.entries()) {
    const idx = tree.talents.findIndex((t) => t.name === talentName);
    if (idx >= 0) return Number(parts[ti]?.[idx] ?? 0);
  }
  return 0;
}
