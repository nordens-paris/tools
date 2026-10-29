// Who a healer is compared with. Top healing parses mostly come from raids with few healers or
// weak co-healers, so peers are picked from WELL-RUN raids instead: the boss's execution and speed
// rankings (whole raids, with their healer count, damage taken and deaths in each row). Among raids
// with the same number of healers and similar damage per healer, we take healers of the same spec
// and assignment, and keep only those whose healing parses are consistently good.
//
// Cost: rankings (cached for hours), 1 request per candidate raid (healing by target, which covers
// every healer in it; the ranking row gives the fight's times), and a fight list and parses lookup
// per healer considered. Raids are checked several at a time, and only until there are enough
// healers to choose from.
import type { HealerPeer, HealerPeerGroup, HealerRole } from '../../../shared/types.ts';
import { TANK_ICON, type HealerSpec, healerSpecFor } from '../../specs/healers.ts';
import type { WclReader } from '../../wcl/reader.ts';
import type { WclRaidRanking } from '../../wcl/types.ts';
import { median } from '../stats.ts';

const PEERS = 5;
/** Candidate raids looked at before settling for fewer peers. */
const MAX_RAIDS = 40;
const MAX_DEATHS = 2;
/**
 * Median healing parse percentile a peer needs over their kills this tier. Parses rank HPS, which
 * is low for everyone in a raid with many healers, so the bar is "at least average", and the most
 * consistent candidates are picked first.
 */
const CONSISTENT_PCT = 50;
const MIN_KILLS = 3;
/** Candidates per tier whose consistency is looked up (1 request each, cached for hours). */
const CONSIDER = 12;
/** Candidate raids checked at once. */
const SCAN_BATCH = 8;

export interface HealerPeerQuery {
  encounterId: number;
  spec: HealerSpec;
  tankShareIcon: number;
  healers: number;
  dtpsPerHealer: number;
  /** Our own raid, never a peer. */
  report: string;
}

/** A healer found in a candidate raid. */
interface Candidate {
  name: string;
  raid: WclRaidRanking & { metric: 'execution' | 'speed'; rank: number };
  tankShareIcon: number;
}

const roleOf = (share: number): HealerRole => (share >= 0.5 ? 'tank' : share >= 0.25 ? 'mixed' : 'raid');

/**
 * Spec from a table icon alone (no spells to look at). A bare "Shaman", "Paladin" or "Druid" doing
 * real healing is Resto/Holy; a bare "Priest" could be Holy or Discipline, so it's skipped.
 */
function specOf(icon: string) {
  const bare: Record<string, string> = { Shaman: 'Shaman-Restoration', Paladin: 'Paladin-Holy', Druid: 'Druid-Restoration', 'Druid-Dreamstate': 'Druid-Restoration' };
  return healerSpecFor(bare[icon] ?? icon);
}

/** Healers of a spec in one raid, with their tank share, from one healing-by-target table. */
async function healersIn(client: WclReader, raid: Candidate['raid'], spec: HealerSpec): Promise<Candidate[]> {
  const start = raid.startTime - raid.reportStart;
  const t = await client.table<{
    entries: { name: string; icon: string; total: number; sources?: { name: string; total: number; type: string }[] }[];
  }>('healing', raid.reportID, { start, end: start + raid.duration, by: 'target' });
  // Everyone gets healed, so the target rows give each player's spec icon, healers included.
  const iconOf = new Map(t.entries.map((e) => [e.name, e.icon]));
  const total = new Map<string, number>();
  const onTanks = new Map<string, number>();
  for (const target of t.entries) {
    for (const s of target.sources ?? []) {
      total.set(s.name, (total.get(s.name) ?? 0) + s.total);
      if (TANK_ICON.test(target.icon)) onTanks.set(s.name, (onTanks.get(s.name) ?? 0) + s.total);
    }
  }
  const raidTotal = [...total.values()].reduce((s, v) => s + v, 0) || 1;
  return [...total]
    .filter(([name, v]) => v > 0.05 * raidTotal && specOf(iconOf.get(name) ?? '')?.icon === spec.icon)
    .map(([name, v]) => ({ name, raid, tankShareIcon: (onTanks.get(name) ?? 0) / v }));
}

/** Median healing parse over the peer's kills this tier, for the same spec. */
async function consistency(client: WclReader, name: string, server: string, region: string, zone: number | undefined, spec: HealerSpec) {
  const specNames = spec.icon === 'Druid-Restoration' ? ['Restoration', 'Dreamstate'] : [spec.icon.split('-')[1]];
  const parses = (await client.parses(name, server, region, zone, 'hps')).filter((p) => specNames.includes(p.spec));
  return parses.length ? { median: median(parses.map((p) => p.percentile)), kills: parses.length } : undefined;
}

export async function findHealerPeers(client: WclReader, q: HealerPeerQuery, log: (msg: string) => void = () => {}): Promise<HealerPeerGroup> {
  const role = roleOf(q.tankShareIcon);
  const you = { healers: q.healers, dtpsPerHealer: q.dtpsPerHealer, role, tankShareIcon: q.tankShareIcon };

  // Candidate raids from both rankings, closest healing environment first.
  const rows: Candidate['raid'][] = [];
  for (const metric of ['execution', 'speed'] as const) {
    for (const page of [1, 2]) {
      const r = await client.raidRankings(q.encounterId, metric, page);
      r.rankings.forEach((row, i) => rows.push({ ...row, metric, rank: (page - 1) * 100 + i + 1 }));
      if (!r.hasMorePages) break;
    }
  }
  const seen = new Set<string>();
  const perHealer = (r: WclRaidRanking) => r.damageTaken / (r.duration / 1000) / Math.max(1, r.healers);
  const gap = (r: WclRaidRanking) => Math.abs(perHealer(r) / q.dtpsPerHealer - 1);
  const raids = rows
    .filter((r) => {
      const key = `${r.reportID}:${r.fightID}`;
      if (seen.has(key) || r.reportID === q.report || r.deaths > MAX_DEATHS || (r as { exploit?: number }).exploit) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Math.abs(a.healers - q.healers) - Math.abs(b.healers - q.healers) || gap(a) - gap(b));

  const tiers: { match: HealerPeerGroup['match']; raid: (r: WclRaidRanking) => boolean; fits: (c: Candidate) => boolean }[] = [
    { match: 'close', raid: (r) => r.healers === q.healers && gap(r) <= 0.25, fits: (c) => roleOf(c.tankShareIcon) === role && Math.abs(c.tankShareIcon - q.tankShareIcon) <= 0.2 },
    { match: 'loose', raid: (r) => Math.abs(r.healers - q.healers) <= 1 && gap(r) <= 0.4, fits: (c) => roleOf(c.tankShareIcon) === role && Math.abs(c.tankShareIcon - q.tankShareIcon) <= 0.2 },
    { match: 'assignment', raid: (r) => Math.abs(r.healers - q.healers) <= 1 && gap(r) <= 0.4, fits: () => true },
  ];

  const picked: (HealerPeer & { tier: HealerPeerGroup['match'] })[] = [];
  const rejected = new Set<string>();
  const found = new Map<string, Candidate[]>();
  let raidsChecked = 0;
  const keyOf = (r: Candidate['raid']) => `${r.reportID}:${r.fightID}`;
  for (const tier of tiers) {
    const fits = (c: Candidate) => tier.fits(c) && !rejected.has(`${c.name}:${c.raid.reportID}`) && !picked.some((p) => p.name === c.name);
    const tierRaids = raids.filter(tier.raid);
    const poolOf = () => tierRaids.flatMap((r) => found.get(keyOf(r)) ?? []);
    // Check raids a batch at a time, until there are enough healers to choose from.
    for (let i = 0; i < tierRaids.length && raidsChecked < MAX_RAIDS; i += SCAN_BATCH) {
      if (new Set(poolOf().filter(fits).map((c) => c.name)).size >= CONSIDER) break;
      const batch = tierRaids
        .slice(i, i + SCAN_BATCH)
        .filter((r) => !found.has(keyOf(r)))
        .slice(0, MAX_RAIDS - raidsChecked);
      raidsChecked += batch.length;
      await Promise.all(batch.map(async (r) => found.set(keyOf(r), await healersIn(client, r, q.spec).catch(() => []))));
    }
    const pool = poolOf();
    log(`Checked ${raidsChecked} raids: ${pool.length} ${q.spec.label}s in ${tier.match} matches`);
    // In the last tier, take the closest assignments first.
    if (tier.match === 'assignment') pool.sort((a, b) => Math.abs(a.tankShareIcon - q.tankShareIcon) - Math.abs(b.tankShareIcon - q.tankShareIcon));
    const chosen = pool.filter((c, i) => fits(c) && pool.findIndex((x) => x.name === c.name) === i).slice(0, CONSIDER);
    // Their parses, all at once (the fight list gives each one's server, for the lookup).
    const checked = await Promise.all(
      chosen.map(async (c) => {
        const fl = await client.fights(c.raid.reportID);
        const actor = fl.friendlies.find((a) => a.name === c.name && a.fights.some((f) => f.id === c.raid.fightID));
        const server = actor?.server ?? c.raid.serverName;
        const cons = await consistency(client, c.name, server, c.raid.regionName, fl.zone, q.spec).catch(() => undefined);
        return { c, server, cons };
      }),
    );
    const considered: (HealerPeer & { tier: HealerPeerGroup['match'] })[] = [];
    for (const { c, server, cons } of checked) {
      if (!cons || cons.kills < MIN_KILLS || cons.median < CONSISTENT_PCT) {
        rejected.add(`${c.name}:${c.raid.reportID}`);
        continue;
      }
      considered.push({
        name: c.name,
        server,
        region: c.raid.regionName,
        report: c.raid.reportID,
        fight: c.raid.fightID,
        raidRanking: { metric: c.raid.metric, rank: c.raid.rank, guild: c.raid.guildName },
        raid: { healers: c.raid.healers, dtpsPerHealer: perHealer(c.raid), deaths: c.raid.deaths, durationSec: c.raid.duration / 1000 },
        tankShareIcon: c.tankShareIcon,
        consistency: cons,
        tier: tier.match,
      });
    }
    considered.sort((a, b) => (b.consistency?.median ?? 0) - (a.consistency?.median ?? 0));
    picked.push(...considered.slice(0, PEERS - picked.length));
    log(`Found ${picked.length}/${PEERS} healers to compare with`);
    if (picked.length >= PEERS) break;
  }

  const match: HealerPeerGroup['match'] = !picked.length ? 'none' : picked.some((p) => p.tier === 'assignment') ? 'assignment' : picked.some((p) => p.tier === 'loose') ? 'loose' : 'close';
  const roleText = role === 'tank' ? 'tank healers' : role === 'mixed' ? 'healers splitting tanks and raid' : 'raid healers';
  const description = {
    close: `${q.spec.label}s, ${roleText} like you, from clean, well-run raids with ${q.healers} healers and about your damage per healer, who parse well on most of their kills.`,
    loose: `${q.spec.label}s, ${roleText} like you, from clean raids with ${q.healers - 1}–${q.healers + 1} healers. No closer matches were found.`,
    assignment: `No ${q.spec.label}s with your assignment were found in clean raids like yours, so these are the closest assignments.`,
    none: `No consistent ${q.spec.label}s were found in clean raids like yours on this boss.`,
  }[match];
  return { match, description, you, peers: picked.map(({ tier: _tier, ...p }) => p), raidsChecked };
}
