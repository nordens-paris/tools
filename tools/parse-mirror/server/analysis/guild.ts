// The whole raid at a glance: every player on every boss kill, with parse, consumes and potions,
// plus the officer checks in raidAudit.ts (gear, parties, boss debuffs). Built from four calls per
// boss (damage table, combatant info, debuff table, one event query) plus each player's parses
// (cached for hours), so it stays cheap on the Warcraft Logs quota.
import type { GuildSummary } from '../../shared/types.ts';
import { mayHeal } from '../specs/healers.ts';
import { mayTank } from '../specs/tanks.ts';
import { mayBeDps, specForIcon } from '../specs/index.ts';
import type { WclClient } from '../wcl/client.ts';
import { parseOf, parsesFor } from './characters.ts';
import { NOT_DPS, consumesAt, fetchRaidEvents, gearIssues, hasTotemOfWrath, partiesOf, potionsUsed, raidDebuffs } from './raidAudit.ts';

export async function guildSummary(client: WclClient, report: string): Promise<GuildSummary> {
  const fights = await client.fights(report);
  const kills = fights.fights.filter((f) => f.boss && f.kill);
  const players = fights.friendlies.filter((a) => a.type !== 'Pet' && a.type !== 'NPC' && kills.some((k) => a.fights.some((f) => f.id === k.id)));

  const perBoss = await Promise.all(
    kills.map(async (f) => {
      const [damage, extra] = await Promise.all([
        client.table('damage-done', report, { start: f.start_time, end: f.end_time }),
        fetchRaidEvents(client, report, f),
      ]);
      const inFight = players.filter((p) => p.fights.some((x) => x.id === f.id));
      return { fight: f, damage, ...extra, parties: partiesOf(inFight, extra.infos, extra.events) };
    }),
  );
  // Gear is checked on each player's latest kill.
  const latestInfo = (id: number) => [...perBoss].reverse().find((b) => b.infos.some((i) => i.sourceID === id));

  // Look up one player first: once their server's region is known, everyone else on it needs
  // only one request.
  const lookup = async (p: (typeof players)[number]) => [p.id, (await parsesFor(client, p.name, p.server, fights.zone)).parses] as const;
  const first = players.length ? [await lookup(players[0])] : [];
  const parses = new Map([...first, ...(await Promise.all(players.slice(1).map(lookup)))]);

  return {
    report,
    title: fights.title,
    startTime: fights.start,
    bosses: kills.map((f) => ({ fight: f.id, encounterId: f.boss, name: f.name, durationSec: (f.end_time - f.start_time) / 1000 })),
    parties: perBoss.map((b) => ({ fight: b.fight.id, ...b.parties })),
    debuffs: raidDebuffs(kills, new Map(perBoss.map((b) => [b.fight.id, b.debuffs])), players),
    players: players
      .map((p) => ({
        source: p.id,
        name: p.name,
        server: p.server,
        icon: p.icon,
        supported: !!specForIcon(p.icon) || mayBeDps(p.icon) || mayHeal(p.icon) || mayTank(p.icon),
        dps: !NOT_DPS.has(p.icon),
        fights: Object.fromEntries(
          perBoss
            .filter((b) => p.fights.some((f) => f.id === b.fight.id))
            .map((b) => {
              const durationSec = (b.fight.end_time - b.fight.start_time) / 1000;
              const total = b.damage.entries.find((e) => e.id === p.id)?.total ?? 0;
              return [
                b.fight.id,
                {
                  dps: durationSec ? total / durationSec : 0,
                  percentile: parseOf(parses.get(p.id) ?? [], fights, b.fight)?.percentile,
                  consumes: consumesAt(b.infos.find((i) => i.sourceID === p.id), p.icon),
                  potions: potionsUsed(b.events, p.id),
                },
              ];
            }),
        ),
        gearIssues: (() => {
          const b = latestInfo(p.id);
          const info = b?.infos.find((i) => i.sourceID === p.id);
          return b && info ? gearIssues(p.icon, info, hasTotemOfWrath(p, players, b.infos, b.parties.groups)) : [];
        })(),
      }))
      .sort((a, b) => Number(b.dps) - Number(a.dps) || a.name.localeCompare(b.name)),
  };
}
