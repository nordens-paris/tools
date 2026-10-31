// Who a tank is compared with. Tank rankings only rank DPS, which rewards tanks in damage gear and
// stances, so peers come from WELL-RUN raids instead (the boss's execution and speed rankings, as
// for healers): tanks of the same class and role (main tank or off-tank), from raids with as many
// tanks and a similar kill time, who didn't die. Tank parses aren't a quality bar here.
//
// Cost: rankings (cached for hours; the spec's own rankings put raids with such a tank first), 1 request per candidate raid (the melee-taken table gives each
// tank's spec icon and share of the boss's melee), and ~8 per peer for their fight.
import type { TankPeer, TankPeerGroup, TankRole } from '../../../shared/types.ts';
import { type TankSpec, tankSpecFor } from '../../specs/tanks.ts';
import { unlessOutage, type WclReader } from '../../wcl/reader.ts';
import type { WclRaidRanking } from '../../wcl/types.ts';
import type { ActorTableEntry } from '../healer/data.ts';
import { bossMeleeShare, fetchTankFightLite, type TankFightData } from './data.ts';

const PEERS = 5;
const MAX_RAIDS = 40;
const SCAN_BATCH = 8;
/** Candidates fetched per tier (the ones who died are dropped). */
const CONSIDER = 8;
const MAX_DEATHS = 2;

export interface TankPeerQuery {
  encounterId: number;
  spec: TankSpec;
  role: TankRole;
  swingShare: number;
  tanks: number;
  durationSec: number;
  report: string;
}

type Raid = WclRaidRanking & { metric: 'execution' | 'speed'; rank: number; startTime: number; reportStart: number };
interface Candidate {
  name: string;
  raid: Raid;
  swingShare: number;
}

const roleOf = (share: number): TankRole => (share >= 0.4 ? 'main' : 'off');

/** Tanks of a spec in one raid, from its melee-taken table. */
async function tanksIn(client: WclReader, raid: Raid, spec: TankSpec): Promise<Candidate[]> {
  const start = raid.startTime - raid.reportStart;
  const t = await client.table<{ entries: (ActorTableEntry & { sources?: { name: string; total: number; type: string }[] })[] }>('damage-taken', raid.reportID, {
    start,
    end: start + raid.duration,
    abilityid: 1,
  });
  return t.entries
    .filter((e) => tankSpecFor(e.icon)?.label === spec.label)
    .map((e) => ({ name: e.name, raid, swingShare: bossMeleeShare(t.entries, e.id) }))
    .filter((c) => c.swingShare > 0.05);
}

export async function findTankPeers(
  client: WclReader,
  q: TankPeerQuery,
  log: (msg: string) => void = () => {},
): Promise<{ group: TankPeerGroup; fights: Map<string, TankFightData> }> {
  const you = { role: q.role, tanks: q.tanks, durationSec: q.durationSec };
  const rows: Raid[] = [];
  for (const metric of ['execution', 'speed'] as const) {
    for (const page of [1, 2]) {
      const r = await client.raidRankings(q.encounterId, metric, page);
      r.rankings.forEach((row, i) => rows.push({ ...(row as Raid), metric, rank: (page - 1) * 100 + i + 1 }));
      if (!r.hasMorePages) break;
    }
  }
  const keyOf = (r: Raid) => `${r.reportID}:${r.fightID}`;
  const seen = new Set<string>();
  const timeGap = (r: Raid) => Math.abs(r.duration / 1000 / q.durationSec - 1);
  const raids = rows
    .filter((r) => {
      if (seen.has(keyOf(r)) || r.reportID === q.report || r.deaths > MAX_DEATHS || (r as { exploit?: number }).exploit) return false;
      seen.add(keyOf(r));
      return true;
    })
    .sort((a, b) => Math.abs(a.tanks - q.tanks) - Math.abs(b.tanks - q.tanks) || timeGap(a) - timeGap(b));
  // The spec's own (DPS) rankings say which raids had a tank of this spec: check those clean raids
  // first, so rarer specs (bears) aren't lost among raids tanked by other classes.
  const withSpec = new Set<string>();
  for (const page of [1, 2, 3]) {
    const r = await client.rankings(q.encounterId, q.spec.wcl.classId, q.spec.wcl.specId, page).catch(unlessOutage(undefined));
    for (const row of r?.rankings ?? []) withSpec.add(`${row.reportID}:${row.fightID}`);
    if (!r?.hasMorePages) break;
  }
  raids.sort((a, b) => Number(withSpec.has(keyOf(b))) - Number(withSpec.has(keyOf(a))));

  const tiers: { match: TankPeerGroup['match']; raid: (r: Raid) => boolean; fits: (c: Candidate) => boolean }[] = [
    { match: 'close', raid: (r) => r.tanks === q.tanks && timeGap(r) <= 0.3, fits: (c) => roleOf(c.swingShare) === q.role },
    { match: 'loose', raid: (r) => Math.abs(r.tanks - q.tanks) <= 1 && timeGap(r) <= 0.5, fits: (c) => roleOf(c.swingShare) === q.role },
    { match: 'role', raid: (r) => Math.abs(r.tanks - q.tanks) <= 1 && timeGap(r) <= 0.5, fits: () => true },
  ];

  const found = new Map<string, Candidate[]>();
  const fights = new Map<string, TankFightData>();
  const picked: (TankPeer & { tier: TankPeerGroup['match'] })[] = [];
  const tried = new Set<string>();
  let raidsChecked = 0;
  for (const tier of tiers) {
    const fits = (c: Candidate) => tier.fits(c) && !tried.has(`${c.name}:${c.raid.reportID}`) && !picked.some((p) => p.name === c.name);
    const tierRaids = raids.filter(tier.raid);
    const poolOf = () => tierRaids.flatMap((r) => found.get(keyOf(r)) ?? []);
    for (let i = 0; i < tierRaids.length && raidsChecked < MAX_RAIDS; i += SCAN_BATCH) {
      if (poolOf().filter(fits).length >= CONSIDER) break;
      const batch = tierRaids
        .slice(i, i + SCAN_BATCH)
        .filter((r) => !found.has(keyOf(r)))
        .slice(0, MAX_RAIDS - raidsChecked);
      raidsChecked += batch.length;
      await Promise.all(batch.map(async (r) => found.set(keyOf(r), await tanksIn(client, r, q.spec).catch(unlessOutage([])))));
    }
    const pool = poolOf().filter(fits);
    // Closest share of the boss first (a 90% main tank compares best with another one).
    pool.sort((a, b) => Math.abs(a.swingShare - q.swingShare) - Math.abs(b.swingShare - q.swingShare));
    log(`Checked ${raidsChecked} raids: ${pool.length} ${q.spec.label}s in ${tier.match} matches`);
    const chosen = pool.slice(0, CONSIDER);
    chosen.forEach((c) => tried.add(`${c.name}:${c.raid.reportID}`));
    const got = await Promise.all(chosen.map((c) => fetchTankFightLite(client, c.raid.reportID, c.raid.fightID, c.name).then((d) => ({ c, d })).catch(unlessOutage(undefined))));
    for (const g of got) {
      if (!g || picked.length >= PEERS) continue;
      // A peer who died isn't one to copy.
      const died = g.d.raid.deaths.some((e) => e.targetID === g.d.tank.id);
      if (died) continue;
      fights.set(`${g.c.raid.reportID}:${g.c.name}`, g.d);
      picked.push({
        name: g.c.name,
        server: g.d.tank.server ?? g.c.raid.serverName,
        region: g.c.raid.regionName,
        report: g.c.raid.reportID,
        fight: g.c.raid.fightID,
        raidRanking: { metric: g.c.raid.metric, rank: g.c.raid.rank, guild: g.c.raid.guildName },
        raid: { tanks: g.c.raid.tanks, healers: g.c.raid.healers, deaths: g.c.raid.deaths, durationSec: g.c.raid.duration / 1000 },
        swingShare: g.c.swingShare,
        tier: tier.match,
      });
    }
    log(`Found ${picked.length}/${PEERS} tanks to compare with`);
    if (picked.length >= PEERS) break;
  }

  const match: TankPeerGroup['match'] = !picked.length ? 'none' : picked.some((p) => p.tier === 'role') ? 'role' : picked.some((p) => p.tier === 'loose') ? 'loose' : 'close';
  const roleText = q.role === 'main' ? 'main tanks' : q.role === 'off' ? 'off-tanks' : 'add tanks';
  const description = {
    close: `${q.spec.label}s, ${roleText} like you, from clean, well-run raids with ${q.tanks} tank${q.tanks === 1 ? '' : 's'} and a similar kill time, who didn't die.`,
    loose: `${q.spec.label}s, ${roleText} like you, from clean raids with about as many tanks. No closer matches were found.`,
    role: `No ${q.spec.label} ${roleText} were found in clean raids like yours, so these are ${q.spec.label}s in other roles.`,
    none: `No ${q.spec.label}s were found in clean raids like yours on this boss.`,
  }[match];
  return { group: { match, description, you, peers: picked.map(({ tier: _tier, ...p }) => p), raidsChecked }, fights };
}
