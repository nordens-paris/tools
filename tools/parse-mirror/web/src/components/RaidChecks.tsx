// The officer checks on the whole-raid page: raid debuffs on the boss, gear problems and party
// setup. The data comes from server/analysis/raidAudit.ts.
import { useState } from 'react';

import type { GearIssue, GuildSummary } from '../../../shared/types.ts';
import { QUALITY_CLASS, fmt, itemIcon, wowheadItem } from '../format.ts';
import { Hint } from './Hint.tsx';

export const shortBoss = (name: string) => name.replace(/^(High Warlord|The|Mother|Lady|Fathom-Lord|High Astromancer) /, '').split(' ')[0];
export const classIcon = (icon: string) => itemIcon(`classicon_${icon.split('-')[0].toLowerCase()}`);

export function PlayerName({ p, guessed }: { p: { name: string; icon: string }; guessed?: boolean }) {
  return (
    <span className={`who ${guessed ? 'guessed' : ''}`}>
      <img className="ic" src={classIcon(p.icon)} alt="" />
      <span className={`cls-${p.icon.split('-')[0]}`}>{p.name}</span>
    </span>
  );
}

export const upClass = (u: number, target: number) => (u >= target ? 'up-ok' : u >= target - 25 ? 'up-warn' : 'up-bad');

/** Raid debuffs on the boss: uptime per kill. */
export function DebuffsPanel({ guild }: { guild: GuildSummary }) {
  if (!guild.debuffs.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>
            Debuffs on the boss
            <Hint text="Share of each kill the debuff was on the boss. Green is on target (Improved Shadow Bolt: 60%, it depends on warlocks' crits; the rest 90%). Low on every debuff for one boss usually means the boss couldn't be attacked for part of the fight (Shade of Akama, Reliquary of Souls)." />
          </h2>
          <p className="sub">Uptime % per kill. These raise everyone's damage, so gaps cost the whole raid.</p>
        </div>
      </div>
      <div className="table-scroll">
        <table className="t guild compact">
          <thead>
            <tr>
              <th>Debuff</th>
              {guild.bosses.map((b) => (
                <th key={b.fight} className="num boss-col" title={b.name}>
                  {shortBoss(b.name).slice(0, 4)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {guild.debuffs.map((d) => (
              <tr key={d.name}>
                <td title={`${d.name}, from ${d.by}`}>
                  <span className="who">
                    <img className="ic" src={itemIcon(d.icon)} alt="" />
                    <span className="debuff-name">{d.name}</span>
                  </span>
                </td>
                {guild.bosses.map((b) => {
                  const u = d.uptime[b.fight] ?? 0;
                  return (
                    <td key={b.fight} className={`num mono ${upClass(u, d.target)}`} title={`${d.name} on ${b.name}: ${fmt(u)}% (target ${d.target}%)`}>
                      {fmt(u)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const ISSUE_ORDER: GearIssue['kind'][] = ['hit', 'enchant', 'socket', 'gem'];
/** "Feet: 2 green gems" -> "2 green". */
const shortIssue = (i: GearIssue) =>
  i.kind === 'hit' ? i.text.replace(/ \(with Totem of Wrath\)/, '').replace(/% of /, '/') : i.kind === 'enchant' ? 'enchant' : i.text.replace(/^.*: /, '').replace(/ (empty )?sockets?$/, ' socket').replace(/ gems?$/, '');

/** One player's gear problems as small chips with the item's icon. */
export function GearChips({ issues }: { issues: GearIssue[] }) {
  return (
    <div className="chips">
      {[...issues]
        .sort((a, b) => ISSUE_ORDER.indexOf(a.kind) - ISSUE_ORDER.indexOf(b.kind))
        .map((issue, i) => (
          <span key={i} className={`chip issue issue-${issue.kind}`} title={issue.item ? `${issue.text} (${issue.item.name})` : issue.text}>
            {issue.item && (
              <a href={wowheadItem(issue.item.id)} target="_blank" rel="noreferrer">
                <img className={`ic sm ${QUALITY_CLASS[issue.item.quality]}`} src={itemIcon(issue.item.icon)} alt={issue.item.name} />
              </a>
            )}
            {shortIssue(issue)}
          </span>
        ))}
    </div>
  );
}

/** Missing enchants, empty sockets, green gems and hit under the cap, per player. */
export function GearPanel({ guild }: { guild: GuildSummary }) {
  const rows = guild.players.filter((p) => p.gearIssues.length).sort((a, b) => b.gearIssues.length - a.gearIssues.length || a.name.localeCompare(b.name));
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>
            Gear check
            <Hint text="From each player's gear on their latest kill. Enchants are checked on the slots everyone can enchant (not rings; ranged only for hunters). Hit is checked for the specs with a full analysis, with their standard talents, Draenei auras and Totem of Wrath when an Elemental shaman was in their party." />
          </h2>
          <p className="sub">{rows.length ? `${rows.length} of ${guild.players.length} players have something to fix.` : 'Everyone is enchanted and gemmed.'}</p>
        </div>
      </div>
      {rows.length > 0 && (
        <div className="gear-check">
          {rows.map((p) => (
            <div key={p.source} className="gear-check-row">
              <PlayerName p={p} />
              <GearChips issues={p.gearIssues} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Who was in which party on a kill, with drums and setup notes. */
export function PartiesPanel({ guild }: { guild: GuildSummary }) {
  const withNotes = guild.parties.filter((p) => p.groups.some((g) => g.notes.length));
  const [fight, setFight] = useState(withNotes[0]?.fight ?? guild.parties[0]?.fight);
  const kill = guild.parties.find((p) => p.fight === fight);
  const player = (id: number) => guild.players.find((p) => p.source === id);
  if (!kill) return null;
  const guessed = kill.groups.flatMap((g) => g.guessed);
  const role = (id: number) => {
    const icon = player(id)?.icon ?? '';
    return /^(Warrior-(Fury|Arms)|Rogue|Shaman-Enhancement|Druid-Feral|Paladin-Retribution|Hunter)/.test(icon) ? 0 : /^(Mage|Warlock|Priest-Shadow|Shaman-Elemental|Druid-Balance)/.test(icon) ? 1 : 2;
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>
            Parties
            <Hint text="Worked out from what only reaches a party: the same drum use, Vampiric Touch mana, and party auras (paladin auras, Battle Shout, Moonkin Aura, Leader of the Pack…). Players with none of those are seated by guess, in the party with room that looks most like their role; setup notes only count the players we're sure of." />
          </h2>
          <p className="sub">
            {withNotes.length ? `Setup notes on ${withNotes.length} of ${guild.parties.length} kills.` : `No setup problems found on ${guild.parties.length} kills.`} Melee want a shaman for Windfury, casters one for Wrath of Air.
          </p>
        </div>
        <select value={fight} onChange={(e) => setFight(Number(e.target.value))} aria-label="Boss kill">
          {guild.parties.map((p) => {
            const boss = guild.bosses.find((b) => b.fight === p.fight);
            const n = p.groups.reduce((s, g) => s + g.notes.length, 0);
            return (
              <option key={p.fight} value={p.fight}>
                {boss?.name ?? p.fight}
                {n ? ` · ${n} note${n > 1 ? 's' : ''}` : ''}
              </option>
            );
          })}
        </select>
      </div>
      <div className="party-grid">
        {kill.groups.map((g, i) => (
          <div key={i} className={`party-card ${g.notes.length ? 'flagged' : ''}`}>
            <div className="party-head">
              <span className="eyebrow">Group {i + 1}</span>
              <span className={`drums ${g.drums ? '' : 'none'}`} title="Drums used in this party on this kill">
                {g.drumIcon && <img className="ic sm" src={itemIcon(g.drumIcon)} alt="" />}
                {g.drums}
              </span>
            </div>
            <ul className="party-members">
              {[...g.members]
                .sort((a, b) => role(a) - role(b))
                .map((id) => {
                  const p = player(id);
                  const guess = g.guessed.includes(id);
                  return (
                    <li key={id} title={guess ? 'Seated by guess: nothing in the log ties this player to a party' : undefined}>
                      {p ? <PlayerName p={p} guessed={guess} /> : `#${id}`}
                      {guess && <span className="guess-mark">?</span>}
                    </li>
                  );
                })}
            </ul>
            {g.notes.map((n) => (
              <div key={n} className="party-note">
                {n}
              </div>
            ))}
          </div>
        ))}
      </div>
      {guessed.length > 0 && (
        <div className="muted small">
          <span className="guess-mark">?</span> Couldn't be placed from the log, so seated by guess: {guessed.map((id) => player(id)?.name ?? `#${id}`).join(', ')}.
        </div>
      )}
    </section>
  );
}
