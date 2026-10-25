// Real talents from classic-armory.org. Logs only record points per tree, so this is the only
// way to sim a player with their actual talents. Responses are cached on disk for a day.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadJson } from '../data/db.ts';
import { game } from '../game.ts';
import { talentSplit } from '../specs/types.ts';

const CACHE_DIR = path.resolve('.cache/armory');
const TTL_MS = 24 * 60 * 60 * 1000;
/** Characters the armory doesn't have are retried after this long. */
const MISS_TTL_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;


interface ArmoryResponse {
  talents?: {
    trees: { specialization_name: string; isActive: boolean; talentRanks: Record<string, { spellId: number; rank: number }> }[];
  };
}

export interface ArmoryTalents {
  /** WoWSims talent string, e.g. "3400502130201-55000005505012050115". */
  talents: string;
  specName: string;
  split: [number, number, number];
}

type TalentTrees = { name: string; talents: { name: string; spellIds: number[]; maxPoints: number }[] }[];

const realmSlug = (realm: string) => realm.toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');

async function fetchArmory(region: string, realm: string, name: string): Promise<ArmoryResponse | undefined> {
  const body = { region: region.toLowerCase(), realm: realmSlug(realm), name: name.toLowerCase(), flavor: game.armoryFlavor };
  const file = path.join(CACHE_DIR, crypto.createHash('sha1').update(JSON.stringify(body)).digest('hex') + '.json');
  try {
    const stat = await fs.stat(file);
    const cached = JSON.parse(await fs.readFile(file, 'utf8')) as ArmoryResponse;
    if (Date.now() - stat.mtimeMs < (cached.talents ? TTL_MS : MISS_TTL_MS)) return cached.talents ? cached : undefined;
  } catch {
    // Not cached.
  }
  const res = await fetch('https://classic-armory.org/api/v1/character/talents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'parse-mirror' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // Server errors aren't remembered; "not found" (or no talents) is, for a while.
  if (res.status >= 500) return undefined;
  const data = res.ok ? ((await res.json().catch(() => undefined)) as ArmoryResponse | undefined) : undefined;
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data?.talents ? data : {}));
  return data?.talents ? data : undefined;
}

/** Converts armory talent ranks (spell IDs) into a WoWSims talent string. */
function toTalentString(trees: TalentTrees, ranks: Record<string, { spellId: number }>): string {
  const have = new Set(Object.values(ranks).map((r) => r.spellId));
  return trees
    .map((tree) =>
      tree.talents
        .map((t) => {
          const idx = t.spellIds.findIndex((id) => have.has(id));
          return idx < 0 ? '0' : String(idx + 1);
        })
        .join('')
        .replace(/0+$/, ''),
    )
    .join('-');
}

/**
 * The player's armory spec that matches the tree split seen in the log (armory data is current,
 * the log may be older or use the other dual spec). Undefined if not found or no spec matches.
 */
export async function armoryTalents(
  className: string,
  name: string,
  realm: string | undefined,
  regions: string[],
  logSplit: [number, number, number],
): Promise<ArmoryTalents | undefined> {
  if (!realm || !game.armoryFlavor) return undefined;
  const trees = loadJson<TalentTrees>(`talents/${className.toLowerCase()}.json`);
  for (const region of regions) {
    const data = await fetchArmory(region, realm, name).catch(() => undefined);
    if (!data?.talents) continue;
    const specs = data.talents.trees.map((t) => {
      const talents = toTalentString(trees, t.talentRanks);
      return { talents, specName: t.specialization_name, split: talentSplit(talents) };
    });
    const match = specs.find((s) => s.split.every((v, i) => v === logSplit[i]));
    if (match) return match;
  }
  return undefined;
}
