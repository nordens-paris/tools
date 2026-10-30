// One player's whole raid: every boss kill in a report, with DPS, parse and the top 10, plus the
// player's consumes, gear, party, the raid debuffs that matter for their damage, and how they did
// next to their own raid. Per boss: the raid's damage table, combatant info, the debuff table and
// one event query (the same calls as the whole-raid page, so they're shared through the cache),
// plus cached rankings. The full analysis runs when a boss is opened.
import type { RaidBoss, RaidSummary } from '../../shared/types.ts';
import { mayHeal } from '../specs/healers.ts';
import { mayTank } from '../specs/tanks.ts';
import { specForIcon } from '../specs/index.ts';
import type { SpecConfig } from '../specs/types.ts';
import type { WclClient } from '../wcl/client.ts';
import { dpsSpecFor } from './analyze.ts';
import { parseOf, parsesFor } from './characters.ts';
import { applyRoleRows, roleRowsOn } from './raidRoles.ts';
import { isTanking } from './tank/data.ts';
import { NOT_DPS, consumesAt, debuffsFor, fetchRaidEvents, gearIssues, hasTotemOfWrath, partiesOf, potionsUsed, raidDebuffs } from './raidAudit.ts';
import { median } from './stats.ts';

const MELEE_OR_HUNTER = /^(Warrior-(Fury|Arms)|Rogue|Shaman-Enhancement|Druid-Feral|Paladin-Retribution|Hunter)/;

/**
 * `roles`: whether the player's healer and tank rows are made here ('server'), left to the browser
 * on the visitor's own key ('browser', see raidRoles.ts), or not made at all ('locked': the server's
 * key when the site requires an own key for them).
 */
export async function raidSummary(client: WclClient, report: string, source: number, roles: 'server' | 'browser' | 'locked' = 'server'): Promise<RaidSummary> {
  const fights = await client.fights(report);
  const actor = fights.friendlies.find((a) => a.id === source);
  if (!actor) throw new Error(`Player ${source} not found in report ${report}`);
  const kills = fights.fights.filter((f) => f.boss && f.kill && actor.fights.some((af) => af.id === f.id));
  // A bare class icon ("Shaman") gets the spec its talents give on most kills (players swap specs
  // between bosses), unless they tanked the first kill. The combatant infos are needed per kill anyway.
  const tankingFirst = !specForIcon(actor.icon) && !!kills[0] && mayTank(actor.icon) && (await isTanking(client, report, kills[0].id, source, fights));
  let spec = specForIcon(actor.icon);
  if (!spec && !tankingFirst && kills.length) {
    const perKill = await Promise.all(kills.map((f) => dpsSpecFor(client, report, f, actor)));
    const counts = new Map<SpecConfig, number>();
    for (const s of perKill) if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
    const [best] = [...counts].sort((a, b) => b[1] - a[1]);
    if (best && best[1] >= kills.length / 2) spec = best[0];
  }
  const players = fights.friendlies.filter((a) => a.type !== 'Pet' && a.type !== 'NPC' && kills.some((k) => a.fights.some((f) => f.id === k.id)));
  const isDps = (icon: string) => !NOT_DPS.has(icon);
  // A bare class icon ("Rogue") reads as the spec its talents give, for the spec-based checks.
  const icon = spec ? `${spec.className}-${spec.specName}` : actor.icon;
  // Players who may be healing get their healing per kill (about 10 more requests per kill, shared
  // with the healer page and the raid's healer panel).
  const can = { heal: !spec && mayHeal(actor.icon), tank: !spec && mayTank(actor.icon) };
  const here = roles === 'server' && (can.heal || can.tank);

  const [parses, perBoss] = await Promise.all([
    parsesFor(client, actor.name, actor.server, fights.zone).then((r) => r.parses),
    Promise.all(
      kills.map(async (f) => {
        const [damage, extra, rankings, roleRows] = await Promise.all([
          client.table('damage-done', report, { start: f.start_time, end: f.end_time }),
          fetchRaidEvents(client, report, f),
          spec ? client.rankings(f.boss, spec.wcl.classId, spec.wcl.specId).catch(() => undefined) : undefined,
          here ? roleRowsOn(client, report, f.id, source, fights, can) : undefined,
        ]);
        const inFight = players.filter((p) => p.fights.some((x) => x.id === f.id));
        return { fight: f, damage, ...extra, rankings, inFight, parties: partiesOf(inFight, extra.infos, extra.events), roleRows };
      }),
    ),
  ]);

  // Compared with others of the same class in the raid; with none, the raid's top three DPS of the
  // same kind (physical or spells).
  const sameClass = players.filter((p) => p.id !== source && isDps(p.icon) && p.icon.split('-')[0] === actor.icon.split('-')[0]);
  const totalOf = (id: number) => perBoss.reduce((s, b) => s + (b.damage.entries.find((e) => e.id === id)?.total ?? 0), 0);
  const sameRole = players
    .filter((p) => p.id !== source && isDps(p.icon) && MELEE_OR_HUNTER.test(p.icon) === MELEE_OR_HUNTER.test(icon))
    .sort((a, b) => totalOf(b.id) - totalOf(a.id))
    .slice(0, 3);
  const peers = sameClass.length ? sameClass.slice(0, 4) : sameRole;

  const wanted = debuffsFor(icon);
  const allDebuffs = raidDebuffs(kills, new Map(perBoss.map((b) => [b.fight.id, b.debuffs])), players).filter((d) => wanted.includes(d.name));
  const pulledAt = (f: (typeof kills)[number]) => (fights.start ?? 0) + f.start_time;

  const bosses = perBoss.map((b): RaidBoss => {
    const f = b.fight;
    const durationSec = (f.end_time - f.start_time) / 1000;
    const dpsOf = (id: number) => (durationSec ? (b.damage.entries.find((e) => e.id === id)?.total ?? 0) / durationSec : 0);
    const top = b.rankings?.rankings.slice(0, 10) ?? [];
    const raidDps = b.inFight.filter((p) => isDps(p.icon)).map((p) => ({ id: p.id, dps: dpsOf(p.id) })).sort((x, y) => y.dps - x.dps);
    const rank = raidDps.findIndex((x) => x.id === source) + 1;
    const own = parses.filter((p) => p.encounterID === f.boss);
    const earlier = own.filter((p) => p.startTime < pulledAt(f) - 120_000).sort((x, y) => y.startTime - x.startTime)[0];
    return {
      fight: f.id,
      encounterId: f.boss,
      name: f.name,
      durationSec,
      dps: dpsOf(source),
      percentile: parseOf(parses, fights, f)?.percentile,
      topMedianDps: top.length ? median(top.map((r) => r.total)) : undefined,
      topMedianDurationSec: top.length ? median(top.map((r) => r.duration / 1000)) : undefined,
      previous: earlier ? { percentile: earlier.percentile, startTime: earlier.startTime } : undefined,
      bestPercentile: own.length ? Math.max(...own.map((p) => p.percentile)) : undefined,
      raidRank: rank && isDps(actor.icon) ? { rank, of: raidDps.length } : undefined,
      peerDps: Object.fromEntries(peers.filter((p) => p.fights.some((x) => x.id === f.id)).map((p) => [p.id, dpsOf(p.id)])),
      consumes: consumesAt(
        b.infos.find((i) => i.sourceID === source),
        actor.icon,
      ),
      potions: potionsUsed(b.events, source),
      party: b.parties.groups.find((g) => g.members.includes(source)),
      debuffs: allDebuffs.map((d) => ({ name: d.name, icon: d.icon, uptime: d.uptime[f.id] ?? 0, target: d.target })),
    };
  });

  const healerLocked = roles === 'locked' && (can.heal || can.tank);
  const latest = [...perBoss].reverse().find((b) => b.infos.some((i) => i.sourceID === source));
  const latestInfo = latest?.infos.find((i) => i.sourceID === source);
  const inParties = new Set(bosses.flatMap((b) => b.party?.members ?? []));
  const summary: RaidSummary = {
    report,
    title: fights.title,
    startTime: fights.start,
    player: {
      name: actor.name,
      server: actor.server,
      icon: actor.icon,
      source,
      supported: !!spec || healerLocked,
      dps: isDps(actor.icon),
      healerLocked,
      rolesPending: roles === 'browser' && (can.heal || can.tank) ? can : undefined,
    },
    bosses,
    peers: { basis: sameClass.length ? 'class' : 'role', players: peers.map((p) => ({ source: p.id, name: p.name, icon: p.icon })) },
    people: Object.fromEntries(players.filter((p) => inParties.has(p.id)).map((p) => [p.id, { name: p.name, icon: p.icon }])),
    gearIssues: latest && latestInfo ? gearIssues(icon, latestInfo, hasTotemOfWrath(actor, players, latest.infos, latest.parties.groups)) : [],
  };
  // Left to the browser, or locked: the player stays as DPS until the rows are in.
  return roles === 'server' ? applyRoleRows(summary, new Map(perBoss.flatMap((b) => (b.roleRows ? [[b.fight.id, b.roleRows] as const] : [])))) : summary;
}
