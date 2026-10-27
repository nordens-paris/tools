// One player's whole raid: every boss kill in a report, with DPS, parse and the top 10, plus the
// player's consumes, gear, party, the raid debuffs that matter for their damage, and how they did
// next to their own raid. Per boss: the raid's damage table, combatant info, the debuff table and
// one event query (the same calls as the whole-raid page, so they're shared through the cache),
// plus cached rankings. The full analysis runs when a boss is opened.
import type { RaidBoss, RaidSummary } from '../../shared/types.ts';
import { mayHeal } from '../specs/healers.ts';
import { specForIcon } from '../specs/index.ts';
import type { WclClient } from '../wcl/client.ts';
import { parseOf, parsesFor } from './characters.ts';
import { fetchHealerFight } from './healer/data.ts';
import { healerMetrics } from './healer/metrics.ts';
import { FightModel } from './healer/model.ts';
import { raidRow } from './healer/raid.ts';
import { NOT_DPS, consumesAt, debuffsFor, fetchRaidEvents, gearIssues, hasTotemOfWrath, partiesOf, potionsUsed, raidDebuffs } from './raidAudit.ts';
import { median } from './stats.ts';

const MELEE_OR_HUNTER = /^(Warrior-(Fury|Arms)|Rogue|Shaman-Enhancement|Druid-Feral|Paladin-Retribution|Hunter)/;

/** `healers`: whether a healer's healing may be fetched (off on the server's key when the site requires an own key). */
export async function raidSummary(client: WclClient, report: string, source: number, healers = true): Promise<RaidSummary> {
  const fights = await client.fights(report);
  const actor = fights.friendlies.find((a) => a.id === source);
  if (!actor) throw new Error(`Player ${source} not found in report ${report}`);
  const spec = specForIcon(actor.icon);
  const kills = fights.fights.filter((f) => f.boss && f.kill && actor.fights.some((af) => af.id === f.id));
  const players = fights.friendlies.filter((a) => a.type !== 'Pet' && a.type !== 'NPC' && kills.some((k) => a.fights.some((f) => f.id === k.id)));
  const isDps = (icon: string) => !NOT_DPS.has(icon);
  // Players who may be healing get their healing per kill (about 10 more requests per kill, shared
  // with the healer page and the raid's healer panel).
  const couldHeal = healers && !spec && mayHeal(actor.icon);

  const [parses, perBoss] = await Promise.all([
    parsesFor(client, actor.name, actor.server, fights.zone).then((r) => r.parses),
    Promise.all(
      kills.map(async (f) => {
        const [damage, infos, extra, rankings, healerData] = await Promise.all([
          client.table('damage-done', report, { start: f.start_time, end: f.end_time }),
          client.combatantInfos(report, f.start_time, f.end_time),
          fetchRaidEvents(client, report, f),
          spec ? client.rankings(f.boss, spec.wcl.classId, spec.wcl.specId).catch(() => undefined) : undefined,
          couldHeal ? fetchHealerFight(client, report, f.id, fights) : undefined,
        ]);
        const inFight = players.filter((p) => p.fights.some((x) => x.id === f.id));
        const model = healerData && new FightModel(healerData);
        const healing = model?.healers.has(source) ? raidRow(healerMetrics(model, source)) : undefined;
        return { fight: f, damage, infos, ...extra, rankings, inFight, parties: partiesOf(inFight, infos, extra.events), healing };
      }),
    ),
  ]);

  // Compared with others of the same class in the raid; with none, the raid's top three DPS of the
  // same kind (physical or spells).
  const sameClass = players.filter((p) => p.id !== source && isDps(p.icon) && p.icon.split('-')[0] === actor.icon.split('-')[0]);
  const totalOf = (id: number) => perBoss.reduce((s, b) => s + (b.damage.entries.find((e) => e.id === id)?.total ?? 0), 0);
  const sameRole = players
    .filter((p) => p.id !== source && isDps(p.icon) && MELEE_OR_HUNTER.test(p.icon) === MELEE_OR_HUNTER.test(actor.icon))
    .sort((a, b) => totalOf(b.id) - totalOf(a.id))
    .slice(0, 3);
  const peers = sameClass.length ? sameClass.slice(0, 4) : sameRole;

  const wanted = debuffsFor(actor.icon);
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
      healing: b.healing,
    };
  });

  const healer = bosses.filter((b) => b.healing).length * 2 >= Math.max(1, bosses.length);
  const healerLocked = !healers && !spec && mayHeal(actor.icon);
  const latest = [...perBoss].reverse().find((b) => b.infos.some((i) => i.sourceID === source));
  const latestInfo = latest?.infos.find((i) => i.sourceID === source);
  const inParties = new Set(bosses.flatMap((b) => b.party?.members ?? []));
  return {
    report,
    title: fights.title,
    player: { name: actor.name, server: actor.server, icon: actor.icon, source, supported: !!spec || healer || healerLocked, dps: isDps(actor.icon) && !healer, healer, healerLocked },
    bosses,
    peers: { basis: sameClass.length ? 'class' : 'role', players: peers.map((p) => ({ source: p.id, name: p.name, icon: p.icon })) },
    people: Object.fromEntries(players.filter((p) => inParties.has(p.id)).map((p) => [p.id, { name: p.name, icon: p.icon }])),
    gearIssues: latest && latestInfo ? gearIssues(actor.icon, latestInfo, hasTotemOfWrath(actor, players, latest.infos, latest.parties.groups)) : [],
  };
}
