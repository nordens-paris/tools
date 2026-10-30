// Runs a full comparison: the player's fight vs the top ranked players of the same spec.
import crypto from 'node:crypto';

import type { AnalysisResult, ComparisonGroup, MetricRow, PlayerFight } from '../../shared/types.ts';
import { mayBeDps, specForIcon, specNameFor, supportedSpecs } from '../specs/index.ts';
import type { SpecConfig } from '../specs/types.ts';
import type { WclClient } from '../wcl/client.ts';
import type { WclActor, WclFight, WclFightsResponse, WclRanking } from '../wcl/types.ts';
import { parseOf, parsesFor } from './characters.ts';
import { collectPlayerFight, findFight, type PlayerFightRaw } from './collect.ts';
import { buildFindings } from './findings.ts';
import { median } from './stats.ts';

export interface StoredAnalysis {
  result: AnalysisResult;
  spec: SpecConfig;
  you: PlayerFightRaw;
  top: PlayerFightRaw[];
}

const TOP_N = 10;

/**
 * The DPS spec module for a player: by icon, or for a bare class icon ("Druid") by the talent tree
 * with the most points in the fight's combatant info. A bare icon may be a tank: check that first.
 */
export async function dpsSpecFor(client: WclClient, report: string, fight: WclFight, actor: WclActor): Promise<SpecConfig | undefined> {
  const byIcon = specForIcon(actor.icon);
  if (byIcon || !mayBeDps(actor.icon)) return byIcon;
  const split = await talentSplitOf(client, report, fight, actor.id);
  return split ? specForIcon(actor.icon, split) : undefined;
}

async function talentSplitOf(client: WclClient, report: string, fight: WclFight, source: number): Promise<[number, number, number] | undefined> {
  const info = (await client.combatantInfos(report, fight.start_time, fight.end_time)).find((i) => i.sourceID === source);
  const t = info?.talents ?? [];
  return info ? [t[0]?.id ?? 0, t[1]?.id ?? 0, t[2]?.id ?? 0] : undefined;
}

/** The spec name ("Affliction") from the icon, or for a bare class icon from the talents. */
export async function specNameOf(client: WclClient, report: string, fight: WclFight, actor: WclActor): Promise<string | undefined> {
  return specNameFor(actor.icon, actor.icon.includes('-') ? undefined : await talentSplitOf(client, report, fight, actor.id));
}

/** "Affliction Warlock" for an icon, or for a bare class icon from the talents. */
async function specLabelOf(client: WclClient, report: string, fight: WclFight, actor: WclActor): Promise<string> {
  const [cls] = actor.icon.split('-');
  const name = await specNameOf(client, report, fight, actor);
  return name ? `${name.replace(/([a-z])([A-Z])/g, '$1 $2')} ${cls}` : cls;
}

export async function analyze(
  client: WclClient,
  report: string,
  fightId: number,
  source: number,
  log: (msg: string) => void = () => {},
  mode: ComparisonGroup['mode'] = 'top',
  // The spec when the caller already worked it out (see dpsSpecFor).
  knownSpec?: SpecConfig,
): Promise<StoredAnalysis> {
  const fights = await client.fights(report);
  const fight = findFight(fights, fightId);
  if (!fight.boss) throw new Error(`"${fight.name}" is trash, not a boss fight. Pick a boss kill.`);
  const actor = fights.friendlies.find((a) => a.id === source);
  if (!actor) throw new Error(`Player ${source} not found in this report`);
  const spec = knownSpec ?? (await dpsSpecFor(client, report, fight, actor));
  if (!spec) {
    throw new Error(`${actor.name} is ${await specLabelOf(client, report, fight, actor)}; supported so far: ${supportedSpecs.join(', ')}`);
  }

  log(`Collecting ${actor.name} on ${fight.name}`);
  const warnings: string[] = [];
  // Your other kills can rank too; compare against other players, not yourself.
  const exclude = { report, fight: fightId, name: actor.name, server: actor.server };
  const { group, candidates } =
    mode === 'peers' ? await peerCandidates(client, spec, fights, fight, actor) : await topCandidates(client, spec, fight.boss);
  const [you, top] = await Promise.all([
    collectPlayerFight(client, spec, report, fightId, source),
    collectTopPlayers(client, spec, candidates, TOP_N, exclude, warnings, log),
  ]);
  if (!fight.kill) warnings.push(`This fight was a wipe; the ${group.players} are compared on kills, so expect differences.`);

  const metrics = buildMetrics(spec, you.fight, top.map((t) => t.fight));
  const findings = buildFindings(spec, you.fight, top.map((t) => t.fight), metrics, group);

  if (you.combatant === undefined) warnings.push('No gear/talent info in the log for this player (combatant info missing).');
  if (you.fight.talentSource === 'preset') {
    warnings.push("Your talents weren't found on the armory for this spec, so the sim uses the standard build with your tree split.");
  }

  const result: AnalysisResult = {
    id: crypto.randomUUID(),
    comparison: group,
    generatedAt: new Date().toISOString(),
    startTime: (fights.start ?? 0) + fight.start_time,
    encounter: { id: fight.boss, name: fight.name },
    spec: { className: spec.className, specName: spec.specName, caster: spec.caster, activityLabel: spec.activityLabel },
    you: you.fight,
    top: top.map((t) => t.fight),
    metrics,
    findings,
    warnings,
  };
  return { result, spec, you, top };
}

type Candidate = { ranking: WclRanking; rank: number };

const TOP_GROUP: ComparisonGroup = {
  mode: 'top',
  label: 'Top 10',
  description: 'The 10 best parses of your spec on this boss.',
  players: 'top players',
  short: 'Top 10',
};

export async function topCandidates(client: WclClient, spec: SpecConfig, encounterId: number) {
  const rankings = await client.rankings(encounterId, spec.wcl.classId, spec.wcl.specId);
  return { group: TOP_GROUP, candidates: rankings.rankings.map((ranking, i) => ({ ranking, rank: i + 1 })) };
}

// Rankings only go 20 pages (2,000 parses) deep.
const MAX_RANKING_PAGE = 20;

/**
 * Players with about your item level whose kill parsed a bit better than yours (5-25 percentile
 * points): what people one step ahead with the same gear do differently. Less luck-driven and
 * easier to copy than the world's best.
 */
async function peerCandidates(client: WclClient, spec: SpecConfig, fights: WclFightsResponse, fight: WclFight, actor: WclActor) {
  const { parses } = await parsesFor(client, actor.name, actor.server, fights.zone);
  const mine = parseOf(parses, fights, fight);
  if (!mine?.rank || !mine.outOf) {
    throw new Error('This kill isn’t ranked on Warcraft Logs, so there’s no “same gear, a step ahead” group for it. Compare with the top 10 instead.');
  }
  const ilvl = mine.ilvlKeyOrPatch;
  const pctLo = Math.min(99, mine.percentile + 5);
  const pctHi = Math.min(99.9, mine.percentile + 25);
  const rankFrom = Math.max(1, Math.round(mine.outOf * (1 - pctHi / 100)));
  const rankTo = Math.max(rankFrom, Math.round(mine.outOf * (1 - pctLo / 100)));
  // Up to three pages of rankings from the top of the band (cached for hours).
  const firstPage = Math.min(MAX_RANKING_PAGE, Math.ceil(rankFrom / 100));
  const lastPage = Math.min(MAX_RANKING_PAGE, Math.ceil(rankTo / 100), firstPage + 2);
  const pages = await Promise.all(
    Array.from({ length: lastPage - firstPage + 1 }, (_, i) => firstPage + i).map(async (page) =>
      (await client.rankings(fight.boss, spec.wcl.classId, spec.wcl.specId, page)).rankings.map((ranking, i) => ({
        ranking,
        rank: (page - 1) * 100 + i + 1,
      })),
    ),
  );
  const all = pages.flat();
  const reachable = rankFrom <= MAX_RANKING_PAGE * 100;
  // Rankings keep each player's best kill while percentiles count every kill, so the band can
  // reach below your DPS; "a step ahead" should at least out-DPS you.
  const inBand = (reachable ? all.filter((c) => c.rank >= rankFrom && c.rank <= rankTo) : all).filter((c) => c.ranking.total > mine.total);
  const near = (window: number) =>
    inBand.filter((c) => ilvl === undefined || c.ranking.itemLevel === undefined || Math.abs(c.ranking.itemLevel - ilvl) <= window);
  const window = near(4).length >= 10 ? 4 : 8;
  const gap = (c: Candidate) => Math.abs((c.ranking.itemLevel ?? 0) - (ilvl ?? 0));
  const candidates = near(window).sort((a, b) => gap(a) - gap(b) || a.rank - b.rank);
  const group: ComparisonGroup = {
    mode: 'peers',
    label: 'Same gear, a step ahead',
    description:
      `Players with item level ${ilvl !== undefined ? `${ilvl - window}–${ilvl + window}` : 'like yours'} whose kill parsed ` +
      `${Math.round(pctLo)}–${Math.round(pctHi)} (yours: ${Math.round(mine.percentile)}).` +
      (reachable ? '' : ' Rankings only go 2,000 deep, so these are the closest listed.'),
    players: 'players a step ahead',
    short: 'Peer',
  };
  return { group, candidates };
}

/** Collects ranked players' fights from a list of candidates, skipping private/broken reports. */
export async function collectTopPlayers(
  client: WclClient,
  spec: SpecConfig,
  ranked: Candidate[],
  count: number,
  exclude: { report: string; fight: number; name?: string; server?: string } | undefined,
  warnings: string[],
  log: (msg: string) => void = () => {},
): Promise<PlayerFightRaw[]> {
  const top: PlayerFightRaw[] = [];
  const candidates = ranked.filter(
    ({ ranking: r }) =>
      !r.hidden &&
      !(r.reportID === exclude?.report && r.fightID === exclude?.fight) &&
      !(exclude?.name && r.name === exclude.name && (!exclude.server || r.serverName === exclude.server)),
  );
  let next = 0;
  // Collect in parallel batches until we have enough.
  while (top.length < count && next < candidates.length && next < count + 10) {
    const batch = candidates.slice(next, next + (count - top.length));
    next += batch.length;
    const results = await Promise.allSettled(
      batch.map(async ({ ranking: r, rank }) => {
        const rFights = await client.fights(r.reportID);
        const rActor = rFights.friendlies.find(
          (a) => a.name === r.name && a.type === spec.wcl.actorType && a.fights.some((f) => f.id === r.fightID),
        );
        if (!rActor) throw new Error(`could not find ${r.name} in report ${r.reportID}`);
        return collectPlayerFight(client, spec, r.reportID, r.fightID, rActor.id, { rank, server: r.serverName, region: r.regionName, assumePetScrolls: true });
      }),
    );
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') top.push(res.value);
      else warnings.push(`Skipped rank ${batch[i].rank} (${batch[i].ranking.name}): ${res.reason?.message ?? res.reason}`);
    });
    log(`Collected ${top.length}/${count} players to compare with`);
  }
  return top.sort((a, b) => (a.fight.rank ?? Infinity) - (b.fight.rank ?? Infinity));
}

/** The pet's share of a player's damage (a hunter's pet, a warlock's demon), 0..100. */
const petShare = (p: PlayerFight) => (p.pets ?? []).filter((x) => x.kind === 'pet').reduce((s, x) => s + x.sharePct, 0);

function row(
  key: string,
  label: string,
  you: number,
  top: (number | null)[],
  higherIsBetter: boolean | null,
  extra: Partial<MetricRow> = {},
): MetricRow {
  // null = no data for that player (e.g. gear missing from the log); leave them out of the stats.
  const vals = top.filter((v): v is number => v !== null);
  return {
    key,
    label,
    you,
    median: median(vals),
    min: vals.length ? Math.min(...vals) : 0,
    max: vals.length ? Math.max(...vals) : 0,
    top,
    higherIsBetter,
    ...extra,
  };
}

function buildMetrics(spec: SpecConfig, you: PlayerFight, top: PlayerFight[]): AnalysisResult['metrics'] {
  const cpm = (p: PlayerFight, name: string) => p.casts.find((c) => c.name === name)?.perMinute ?? 0;
  const icon = (name: string) => [you, ...top].flatMap((p) => p.casts).find((c) => c.name === name)?.icon;
  const uptime = (p: PlayerFight, name: string) => p.buffs.find((b) => b.name === name)?.uptimePct ?? 0;
  const buffIcon = (name: string) => [you, ...top].flatMap((p) => p.buffs).find((b) => b.name === name)?.icon;

  // Rows where nobody has a value (e.g. an untalented ability) are just noise.
  const nonZero = (rows: MetricRow[]) => rows.filter((r) => r.you > 0 || r.top.some((v) => (v ?? 0) > 0));

  const anyPi = [you, ...top].some((p) => p.powerInfusion);
  const noPi = (p: PlayerFight) => p.dps - (p.powerInfusion?.dps ?? 0);

  return {
    summary: [
      row('dps', 'DPS', you.dps, top.map((p) => p.dps), true),
      ...(anyPi ? [row('dpsNoPi', 'DPS without Power Infusion', noPi(you), top.map(noPi), true)] : []),
      row('duration', 'Kill time', you.durationSec, top.map((p) => p.durationSec), false, { unit: 's' }),
      row('ilvl', 'Avg item level', you.avgItemLevel, top.map((p) => (p.gear.length ? p.avgItemLevel : null)), true),
      row('hit', `Hit chance (cap ${spec.hit.capPct}%)`, you.hit?.pct ?? 0, top.map((p) => p.hit?.pct ?? null), null, { unit: '%', digits: 1 }),
      ...(spec.expertise
        ? [row('expertise', 'Expertise (26 takes away dodge)', you.expertise?.points ?? 0, top.map((p) => p.expertise?.points ?? null), null, { digits: 0 })]
        : []),
      ...([you, ...top].some((p) => p.pets?.some((x) => x.kind === 'pet'))
        ? [row('petShare', 'Pet damage share', petShare(you), top.map(petShare), null, { unit: '%' })]
        : []),
      row('active', spec.activityLabel, you.activePct, top.map((p) => p.activePct), true, { unit: '%' }),
      row('idle', 'Idle time', you.idleSec, top.map((p) => p.idleSec), false, { unit: 's' }),
      ...(spec.rageFromDamageTaken
        ? [
            row('rageTaken', 'Rage from damage taken', you.rageFromDamageTaken?.perMinute ?? 0, top.map((p) => p.rageFromDamageTaken?.perMinute ?? null), true, {
              unit: '/min',
            }),
          ]
        : []),
    ],
    casts: nonZero(spec.trackedCasts.map((t) =>
      row(`cpm:${t.name}`, t.name, cpm(you, t.name), top.map((p) => cpm(p, t.name)), t.higherIsBetter, {
        icon: icon(t.name),
        unit: '/min',
      }),
    )),
    uptimes: nonZero([
      ...spec.uptimes.map((name) =>
        row(`up:${name}`, name, uptime(you, name), top.map((p) => uptime(p, name)), true, { icon: buffIcon(name), unit: '%' }),
      ),
      ...(spec.debuffUptimes ?? []).map((name) => {
        const up = (p: PlayerFight) => p.ownDebuffs.find((d) => d.name === name)?.uptimePct ?? 0;
        const dIcon = [you, ...top].flatMap((p) => p.ownDebuffs).find((d) => d.name === name)?.icon;
        return row(`debuff:${name}`, `${name} (on boss)`, up(you), top.map(up), null, { icon: dIcon, unit: '%' });
      }),
    ]),
    efficiency: spec.efficiency.map(({ name }) => {
      const eff = (p: PlayerFight) => p.abilityEfficiency.find((e) => e.name === name)?.pct ?? 0;
      return row(`eff:${name}`, `${name} cast efficiency`, eff(you), top.map(eff), true, { icon: icon(name), unit: '%' });
    }),
  };
}
