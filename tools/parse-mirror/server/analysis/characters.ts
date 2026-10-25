// Finding a character's ranked kills. Logs don't say which region a character is from, so regions
// are tried until one has the character.
import type { WclClient } from '../wcl/client.ts';
import type { WclFight, WclFightsResponse, WclParse } from '../wcl/types.ts';

const REGIONS = ['EU', 'US', 'KR', 'TW', 'CN'];
/** Region each character was found in, so later lookups ask once. */
const regionOf = new Map<string, string>();
/** A server is in one region; once known, its other characters only need one try. */
const serverRegion = new Map<string, string>();

/** All ranked kills of a character in a raid tier (default: the current one), and their region. */
export async function parsesFor(
  client: WclClient,
  name: string,
  server: string | undefined,
  zone?: number,
): Promise<{ parses: WclParse[]; region?: string }> {
  if (!server) return { parses: [] };
  const id = `${name}-${server}`;
  const known = regionOf.get(id) ?? serverRegion.get(server);
  for (const region of known ? [known] : REGIONS) {
    try {
      const parses = await client.parses(name, server, region, zone);
      if (parses.length) {
        regionOf.set(id, region);
        serverRegion.set(server, region);
        return { parses, region };
      }
    } catch {
      // Character not found in this region.
    }
  }
  return { parses: [] };
}

/**
 * The parse for one kill. When several people log the same raid, Warcraft Logs ranks only one of
 * the reports, so match on boss and pull time rather than on report code.
 */
export function parseOf(parses: WclParse[], fights: WclFightsResponse, fight: WclFight): WclParse | undefined {
  const pulled = (fights.start ?? 0) + fight.start_time;
  return parses.find((p) => p.encounterID === fight.boss && Math.abs(p.startTime - pulled) < 120_000);
}
