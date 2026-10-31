import type { ReactNode } from 'react';

import { median as med } from '../../../../server/analysis/stats.ts';
import type { TankAnalysis, TankMetrics, TankTab } from '../../../../shared/types.ts';
import { abilityIcon, fmt, fmtDate, fmtTime, wclReportUrl, wclUrl } from '../../format.ts';
import { Findings } from '../Findings.tsx';
import { Hint } from '../Hint.tsx';
import { Kpi } from '../SummaryCards.tsx';
import { RowTable, fmtRow, iconOf, pct, rowTone } from '../healer/HealerTables.tsx';
import { TankOpener } from './TankOpener.tsx';
import { TankSim } from './TankSim.tsx';

export const TANK_TABS: TankTab[] = ['Overview', 'Survivability', 'Swings', 'Mitigation', 'Threat', 'Cooldowns', 'Sim', 'Peers'];

const ROLE: Record<TankMetrics['role'], string> = { main: 'Main tank', off: 'Off-tank', adds: 'Add tank' };
const MATCH: Record<TankAnalysis['group']['match'], { label: string; pill: string }> = {
  close: { label: 'Close match', pill: 'ok' },
  loose: { label: 'Looser match', pill: 'acc' },
  role: { label: 'Other role', pill: 'warn' },
  none: { label: 'No peers found', pill: 'bad' },
};
const k = (v: number) => `${(v / 1000).toFixed(1)}k`;
type Row = { name: string; m: TankMetrics; you?: boolean };
const rowsOf = (a: TankAnalysis): Row[] => [{ name: `${a.you.name} (you)`, m: a.you, you: true }, ...a.peers.map((p) => ({ name: p.name, m: p as TankMetrics }))];

function TankHeader({ analysis: a, picker, onRaid }: { analysis: TankAnalysis; picker?: ReactNode; onRaid?: () => void }) {
  const you = a.you;
  return (
    <section className="report-head">
      <img className="spec-icon" src={iconOf(you.icon)} alt="" />
      <div className="report-title">
        <div className="eyebrow">
          {you.specLabel} · {a.encounter.name}
        </div>
        <h1>{you.name}</h1>
        <div className="report-meta">
          <span className={`pill ${a.kill ? 'ok' : 'bad'}`}>
            {a.kill ? 'Kill' : 'Wipe'} · {fmtTime(a.durationSec)}
          </span>
          {a.startTime ? <span className="pill">{fmtDate(a.startTime)}</span> : null}
          <span className="pill acc" title="Share of the enemy's melee on players that you took.">
            {ROLE[you.role]} · {pct(you.swingShare)} of {you.tanked}
          </span>
          {a.raidTanks.length > 0 && <span className="pill">With {a.raidTanks.map((t) => t.name).join(', ')}</span>}
          {you.died && <span className="pill bad">Died</span>}
        </div>
      </div>
      <div className="head-actions report-actions">
        {picker}
        {onRaid && (
          <button className="btn" onClick={onRaid} title={`${you.name} on every boss in this raid`}>
            Whole raid →
          </button>
        )}
        <a className="btn" href={wclUrl(a.report, a.fight, you.source).replace('type=damage-done', 'type=damage-taken')} target="_blank" rel="noreferrer">
          Warcraft Logs ↗
        </a>
      </div>
    </section>
  );
}

function TankKpis({ analysis: a }: { analysis: TankAnalysis }) {
  const row = (key: string) => [...a.judged, ...a.context].find((r) => r.key === key);
  const kpi = (key: string, label: string, hint?: string) => {
    const r = row(key);
    if (!r) return null;
    const tone = rowTone(r);
    const scale = r.format === 'pct' ? 100 : 1;
    return (
      <Kpi
        label={label}
        hint={hint ?? r.hint}
        value={r.key === 'ehp' && r.you !== null ? k(r.you) : fmtRow(r.format, r.you)}
        sub={`Peer median ${r.key === 'ehp' && r.median !== null ? k(r.median) : fmtRow(r.format, r.median)}`}
        delta={tone === 'neutral' || r.you === null || r.median === null ? undefined : (r.you - r.median) * scale}
        deltaUnit={r.format === 'pct' ? ' pts' : ''}
        digits={r.format === 'dec' ? 1 : 0}
        good={tone === 'good'}
      />
    );
  };
  const blocker = a.you.className !== 'Druid';
  return (
    <section className="kpis">
      {kpi('ehp', 'Effective health')}
      {kpi('crush', 'Crushes per 100 swings')}
      {blocker ? kpi('coverage', `Swings under ${a.you.mitigation[0]?.name ?? 'mitigation'}`) : kpi('avoid', 'Swings avoided')}
      {kpi('opener', 'Opening threat (10 s)')}
      {kpi('tps', 'Threat per second')}
    </section>
  );
}

function FixFirst({ analysis: a, onTab }: { analysis: TankAnalysis; onTab: (t: TankTab) => void }) {
  const items = a.findings.filter((f) => f.severity === 'high' || f.severity === 'medium').slice(0, 3);
  if (!items.length) return null;
  return (
    <section className="panel fix-first">
      <div className="panel-head">
        <div>
          <h2>Fix first</h2>
          <p className="sub">The changes most likely to make you harder to kill and easier to tank behind, judged on what's in your hands.</p>
        </div>
      </div>
      <ol className="fix-list">
        {items.map((f, i) => (
          <li key={f.title}>
            <span className="fix-n">{i + 1}</span>
            <div>
              <div className="strong">{f.title}</div>
              <div className="muted small">{f.detail}</div>
            </div>
            <button className="ghost small" onClick={() => onTab(f.tab)}>
              {f.tab} →
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PeerMatch({ analysis: a, onTab }: { analysis: TankAnalysis; onTab: (t: TankTab) => void }) {
  const g = a.group;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Who you're compared with</h2>
          <p className="sub">{g.description}</p>
        </div>
        <span className={`pill ${MATCH[g.match].pill}`}>{MATCH[g.match].label}</span>
      </div>
      {a.peers.length > 0 && (
        <table className="t">
          <thead>
            <tr>
              <th />
              <th className="num">You</th>
              <th className="num">Peers</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Tanks in the raid</td>
              <td className="num mono">{g.you.tanks}</td>
              <td className="num mono">{med(a.peers.map((p) => p.peer.raid.tanks))}</td>
            </tr>
            <tr>
              <td>Kill time</td>
              <td className="num mono">{fmtTime(a.durationSec)}</td>
              <td className="num mono">{fmtTime(med(a.peers.map((p) => p.durationSec)))}</td>
            </tr>
            <tr>
              <td>Share of the boss's melee</td>
              <td className="num mono">{pct(a.you.swingShare)}</td>
              <td className="num mono">{pct(med(a.peers.map((p) => p.swingShare)))}</td>
            </tr>
          </tbody>
        </table>
      )}
      <div className="muted small">Tank parses rank DPS, which rewards damage gear and stances, so they aren't used to pick peers.</div>
      <button className="ghost small" onClick={() => onTab('Peers')}>
        See the peers →
      </button>
    </section>
  );
}

/** Effective health, armor and health for you and each peer, as bars. */
function Survivability({ analysis: a }: { analysis: TankAnalysis }) {
  const rows = rowsOf(a);
  const max = Math.max(...rows.map((r) => r.m.survivability.effectiveHealth), 1);
  const g = a.you.gear;
  const st = g?.stats ?? {};
  const statRows: [string, string, string?][] = [
    ['Stamina', 'sta'],
    ['Armor (items)', 'armor'],
    ['Bonus armor', 'bonusArmor'],
    ['Defense rating', 'def'],
    ['Dodge rating', 'dodge'],
    ['Parry rating', 'parry'],
    ['Block rating', 'block'],
    ['Block value', 'blockValue'],
    ['Agility', 'agi'],
    ['Strength', 'str'],
    ['Hit rating', 'hit'],
    ['Expertise rating', 'exp'],
  ];
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Effective health</h2>
            <p className="sub">Health ÷ (1 − armor reduction) against a level 73 boss: how much physical damage it takes to kill you from full. Health is measured from big hits (raid buffs and forms included).</p>
          </div>
        </div>
        <div className="ov-rows">
          {rows.map((r) => (
            <div className="ov-row" key={r.name}>
              <span className="small">{r.name}</span>
              <div className="ov-track" title={`${fmt(r.m.survivability.maxHp)} health, ${fmt(r.m.survivability.armor)} armor (${pct(r.m.survivability.armorReduction)} reduction)`}>
                <div className={`ov-seg ${r.you ? 'ov-others' : 'ov-hot'}`} style={{ width: `${(r.m.survivability.effectiveHealth / max) * 100}%` }} />
              </div>
              <span className="mono small">{k(r.m.survivability.effectiveHealth)}</span>
            </div>
          ))}
        </div>
      </section>
      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Crit immunity</h2>
              <p className="sub">A boss crits a tank 5.6% of the time unless defense, talents and resilience take it away.</p>
            </div>
          </div>
          {g ? (
            <table className="t">
              <tbody>
                <tr>
                  <td>Defense skill</td>
                  <td className="num mono">{g.defense}</td>
                </tr>
                <tr>
                  <td>Less chance to be crit</td>
                  <td className={`num mono ${g.critImmune ? 'tone-good' : 'tone-bad'}`}>{g.critReduction.toFixed(2)}% of 5.6%</td>
                </tr>
                <tr>
                  <td>Crits taken on this kill</td>
                  <td className={`num mono ${a.you.swings.crit ? 'tone-bad' : ''}`}>{a.you.swings.crit}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="muted">No gear in the log for this kill.</p>
          )}
          <div className="muted small">
            {a.you.className === 'Druid' ? 'Bears get 3% from Survival of the Fittest; the rest comes from defense and resilience.' : 'Warriors and paladins need 490 defense (Anticipation gives 20).'}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>
                Gear choices
                <Hint text="Stats on your items, gems and enchants. Mitigation share = stamina, armor, defense, avoidance and block, out of those plus threat stats (strength, agility, hit, expertise, attack power, spell damage). Bears count agility half each." />
              </h2>
              <p className="sub">
                {g ? `${pct(g.mitigationLean)} of your gear's stat budget is mitigation (peers ${pct(med(a.peers.map((p) => p.gear?.mitigationLean ?? 0)))}).` : ''}
              </p>
            </div>
          </div>
          <table className="t">
            <thead>
              <tr>
                <th>Stat</th>
                <th className="num">You</th>
                <th className="num">Peers</th>
              </tr>
            </thead>
            <tbody>
              {statRows
                .filter(([, key]) => (st[key] ?? 0) || a.peers.some((p) => p.gear?.stats[key]))
                .map(([label, key]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td className="num mono">{fmt(st[key] ?? 0)}</td>
                    <td className="num mono">{fmt(med(a.peers.map((p) => p.gear?.stats[key] ?? 0)))}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

const OUTCOMES = [
  { key: 'crit', label: 'Crit', cls: 'sw-crit' },
  { key: 'crush', label: 'Crushing', cls: 'sw-crush' },
  { key: 'hit', label: 'Hit', cls: 'sw-hit' },
  { key: 'block', label: 'Blocked', cls: 'sw-block' },
  { key: 'parry', label: 'Parry', cls: 'sw-parry' },
  { key: 'dodge', label: 'Dodge', cls: 'sw-dodge' },
  { key: 'miss', label: 'Miss', cls: 'sw-miss' },
] as const;

function Swings({ analysis: a }: { analysis: TankAnalysis }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>How the boss's swings landed</h2>
          <p className="sub">Every melee swing of the enemy you tanked, by outcome. Crushing blows hit for 150%; warriors and paladins take none with Shield Block or Holy Shield up, bears always take some.</p>
        </div>
        <div className="legend">
          {OUTCOMES.map((o) => (
            <span key={o.key}>
              <i className={`sw ${o.cls}`} /> {o.label}
            </span>
          ))}
        </div>
      </div>
      <div className="ov-rows">
        {rowsOf(a).map((r) => (
          <div className="ov-row" key={r.name}>
            <span className="small">{r.name}</span>
            <div className="ov-track">
              {OUTCOMES.map((o) => {
                const n = r.m.swings[o.key];
                return n ? <div key={o.key} className={`ov-seg ${o.cls}`} style={{ width: `${(n / Math.max(1, r.m.swings.total)) * 100}%` }} title={`${o.label}: ${n} of ${r.m.swings.total}`} /> : null;
              })}
            </div>
            <span className="mono small">{r.m.swings.total}</span>
          </div>
        ))}
      </div>
      <div className="table-scroll">
        <table className="t compact">
          <thead>
            <tr>
              <th>Tank</th>
              <th className="num">Swings</th>
              <th className="num">Avoided</th>
              {OUTCOMES.map((o) => (
                <th key={o.key} className="num">
                  <i className={`sw ${o.cls}`} /> {o.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowsOf(a).map((r) => (
              <tr key={r.name} className={r.you ? 'you' : ''}>
                <td>{r.name}</td>
                <td className="num mono">{r.m.swings.total}</td>
                <td className="num mono strong">{pct(r.m.swings.avoided)}</td>
                {OUTCOMES.map((o) => (
                  <td key={o.key} className={`num mono ${(o.key === 'crit' || o.key === 'crush') && r.m.swings[o.key] ? 'tone-bad' : r.m.swings[o.key] ? '' : 'muted'}`}>
                    {r.m.swings[o.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted small">
        Your hits that landed did {fmt(a.you.swings.damagePerHit)} on average, from {fmt(a.you.swings.unmitigatedPerHit)} before armor and block (the boss and its buffs decide that part).
      </div>
    </section>
  );
}

function Mitigation({ analysis: a }: { analysis: TankAnalysis }) {
  const you = a.you;
  // Debuffs someone kept up for at least a moment (a single early cast rounds to 0% for everyone).
  const names = [...new Set([...you.bossDebuffs, ...a.peers.flatMap((p) => p.bossDebuffs)].filter((d) => d.uptime >= 0.005).map((d) => d.name))];
  return (
    <>
      {you.mitigation.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Active mitigation</h2>
              <p className="sub">Uptime, and more to the point, the share of the swings you took while it was up. Crushing blows can't land while it's up.</p>
            </div>
          </div>
          <table className="t">
            <thead>
              <tr>
                <th>Buff</th>
                <th className="num">Uptime</th>
                <th className="num">Swings covered</th>
                <th className="num">Peers</th>
                <th className="num">Crushes while down</th>
              </tr>
            </thead>
            <tbody>
              {you.mitigation.map((m) => (
                <tr key={m.name}>
                  <td>
                    <span className="spell-name">
                      {m.icon && <img src={abilityIcon(m.icon)} alt="" />}
                      {m.name}
                    </span>
                  </td>
                  <td className="num mono">{pct(m.uptime)}</td>
                  <td className="num mono strong">{pct(m.swingsCovered)}</td>
                  <td className="num mono">{pct(med(a.peers.map((p) => p.mitigation.find((x) => x.name === m.name)?.swingsCovered ?? 0)))}</td>
                  <td className={`num mono ${m.crushesUncovered ? 'tone-bad' : ''}`}>{m.crushesUncovered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Debuffs on the boss</h2>
              <p className="sub">Your uptime of the debuffs you keep on the enemy, next to the peers. Demoralizing Shout/Roar and Thunder Clap make every hit on you smaller or slower; another tank or warrior may keep them up instead.</p>
            </div>
          </div>
          <table className="t">
            <thead>
              <tr>
                <th>Debuff</th>
                <th className="num">You</th>
                <th className="num">Peers</th>
              </tr>
            </thead>
            <tbody>
              {names.map((n) => {
                const mine = you.bossDebuffs.find((d) => d.name === n);
                return (
                  <tr key={n}>
                    <td>
                      <span className="spell-name">
                        {mine?.icon && <img src={abilityIcon(mine.icon)} alt="" />}
                        {n}
                      </span>
                    </td>
                    <td className="num mono">{pct(mine?.uptime ?? 0)}</td>
                    <td className="num mono">{pct(med(a.peers.map((p) => p.bossDebuffs.find((d) => d.name === n)?.uptime ?? 0)))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Stance and form</h2>
              <p className="sub">Time in Defensive Stance, bear form or Righteous Fury: less damage taken (warriors, bears) and more threat.</p>
            </div>
          </div>
          <table className="t">
            <tbody>
              <tr>
                <td>Tanking stance / form / aura</td>
                <td className={`num mono ${you.tankAuraUptime < 0.9 ? 'tone-bad' : ''}`}>{pct(you.tankAuraUptime)}</td>
                <td className="num mono muted">peers {pct(med(a.peers.map((p) => p.tankAuraUptime)))}</td>
              </tr>
              {you.catFormUptime !== undefined && (
                <tr>
                  <td>Cat Form</td>
                  <td className={`num mono ${you.catFormUptime > 0.05 ? 'tone-bad' : ''}`}>{pct(you.catFormUptime)}</td>
                  <td className="num mono muted">peers {pct(med(a.peers.map((p) => p.catFormUptime ?? 0)))}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

function Threat({ analysis: a }: { analysis: TankAnalysis }) {
  const you = a.you;
  const rows = rowsOf(a);
  const max = Math.max(...rows.flatMap((r) => [r.m.threat.tps, ...r.m.threat.opener]), 1);
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Threat</h2>
            <p className="sub">
              Threat per second from your damage and abilities with WoWSims' threat values (stance, form, talents and Righteous Fury included; healing and rage gains aren't counted, as in WoWSims). The first seconds are what the DPS can open on.
            </p>
          </div>
        </div>
        <table className="t">
          <thead>
            <tr>
              <th>Tank</th>
              <th className="num">First 5 s</th>
              <th className="num">First 10 s</th>
              <th className="num">First 20 s</th>
              <th className="num">Whole kill</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className={r.you ? 'you' : ''}>
                <td>{r.name}</td>
                {[...r.m.threat.opener, r.m.threat.tps].map((v, i) => (
                  <td key={i} className="num mono">
                    {fmt(v)}
                  </td>
                ))}
                <td style={{ width: '30%' }}>
                  <div className="ov-track" style={{ height: 8 }}>
                    <div className={`ov-seg ${r.you ? 'ov-others' : 'ov-hot'}`} style={{ width: `${(r.m.threat.tps / max) * 100}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Where your threat comes from</h2>
            <p className="sub">Share of your threat per ability, next to the peers' median.</p>
          </div>
        </div>
        <div className="mana-sources">
          {you.threat.byAbility.map((b) => {
            const peer = med(a.peers.map((p) => p.threat.byAbility.find((x) => x.name === b.name)?.share ?? 0));
            return (
              <div className="mana-source" key={b.name}>
                <span className="spell-name small">
                  {b.icon && <img src={abilityIcon(b.icon)} alt="" />}
                  {b.name}
                </span>
                <div className="share-bars">
                  <div className="share-bar you" style={{ width: `${b.share * 100}%` }} />
                  <div className="share-bar peer" style={{ width: `${peer * 100}%` }} />
                </div>
                <span className="mono small">
                  {pct(b.share)} <span className="muted">/ {pct(peer)}</span>
                </span>
              </div>
            );
          })}
        </div>
      </section>
      {you.holding && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Holding {you.tanked}</h2>
              <p className="sub">Its first swing, and how often it hit players who aren't tanks (mechanics like Fel Rage count here too).</p>
            </div>
          </div>
          <table className="t">
            <tbody>
              <tr>
                <td>First swing</td>
                <td className="num mono">
                  {you.holding.firstSwingSec !== undefined ? `${you.holding.firstSwingSec.toFixed(1)} s` : '–'} {you.holding.firstSwingOnYou ? 'on you' : 'on someone else'}
                </td>
              </tr>
              <tr>
                <td>Swings on players who aren't tanks</td>
                <td className="num mono">
                  {you.holding.swingsOnNonTanks} ({pct(you.holding.nonTankShare)})
                </td>
              </tr>
              <tr>
                <td>Taunts</td>
                <td className="num mono">{you.taunts.length ? you.taunts.map((t) => `${t.name} ${fmtTime(t.atSec)}`).join(', ') : 'none'}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function Cooldowns({ analysis: a }: { analysis: TankAnalysis }) {
  const you = a.you;
  const names = [...new Set([...you.cooldowns, ...a.peers.flatMap((p) => p.cooldowns)].map((c) => c.name))];
  return (
    <div className="grid-2">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Defensive cooldowns and potions</h2>
            <p className="sub">When you used them and your health at the time, and how many of the {a.peers.length} peers used each.</p>
          </div>
        </div>
        <table className="t">
          <thead>
            <tr>
              <th>Cooldown</th>
              <th>You</th>
              <th className="num">Peers</th>
            </tr>
          </thead>
          <tbody>
            {names.map((n) => {
              const mine = you.cooldowns.filter((c) => c.name === n);
              return (
                <tr key={n}>
                  <td>{n}</td>
                  <td className={mine.length ? 'mono small' : 'muted small'}>
                    {mine.length ? mine.map((c) => `${fmtTime(c.atSec)}${c.hpPct !== undefined ? ` (${pct(c.hpPct)})` : ''}`).join(', ') : 'not used'}
                  </td>
                  <td className="num mono">
                    {a.peers.filter((p) => p.cooldowns.some((c) => c.name === n)).length}/{a.peers.length}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Close calls</h2>
            <p className="sub">Times you dropped under 20% health and lived, threat you dropped on yourself, and whether you died.</p>
          </div>
        </div>
        <table className="t">
          <tbody>
            <tr>
              <td>Under 20% health (survived)</td>
              <td className={`num mono ${you.nearDeaths ? 'tone-bad' : ''}`}>{you.nearDeaths}</td>
            </tr>
            <tr>
              <td>Threat dropped on yourself</td>
              <td className={`num mono ${you.threatDrops.length ? 'tone-bad' : ''}`}>{you.threatDrops.map((d) => `${d.name} ${fmtTime(d.atSec)}`).join(', ') || 'none'}</td>
            </tr>
            <tr>
              <td>Died</td>
              <td className={`num mono ${you.died ? 'tone-bad' : ''}`}>{you.died ? 'yes' : 'no'}</td>
            </tr>
            <tr>
              <td>Damage taken per second</td>
              <td className="num mono">{fmt(you.dtps)}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

function PeerTable({ analysis: a }: { analysis: TankAnalysis }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Who you're compared with</h2>
          <p className="sub">{a.group.description}</p>
        </div>
      </div>
      <div className="table-scroll">
        <table className="t">
          <thead>
            <tr>
              <th>Tank</th>
              <th>Raid</th>
              <th className="num">Tanks</th>
              <th className="num">Deaths</th>
              <th className="num">Boss share</th>
              <th className="num">Effective health</th>
              <th className="num">TPS</th>
            </tr>
          </thead>
          <tbody>
            <tr className="you">
              <td>
                <span className="spell-name">
                  <img src={iconOf(a.you.icon)} alt="" />
                  <strong>{a.you.name}</strong> <span className="muted small">you</span>
                </span>
              </td>
              <td className="muted">{fmtTime(a.durationSec)}</td>
              <td className="num mono">{a.group.you.tanks}</td>
              <td className="num mono">–</td>
              <td className="num mono">{pct(a.you.swingShare)}</td>
              <td className="num mono">{k(a.you.survivability.effectiveHealth)}</td>
              <td className="num mono">{fmt(a.you.threat.tps)}</td>
            </tr>
            {a.peers.map((p) => (
              <tr key={`${p.peer.report}:${p.name}`}>
                <td>
                  <a className="spell-name" href={`${wclReportUrl(p.peer.report)}?fight=${p.peer.fight}&source=${p.source}&type=damage-taken`} target="_blank" rel="noreferrer">
                    <img src={iconOf(p.icon)} alt="" />
                    {p.name}
                    <span className="muted small">{p.peer.region}</span>
                  </a>
                </td>
                <td>
                  <span className="muted small">
                    {p.peer.raidRanking.guild ?? 'Raid'} · {p.peer.raidRanking.metric} #{p.peer.raidRanking.rank} · {fmtTime(p.durationSec)}
                  </span>
                </td>
                <td className="num mono">{p.peer.raid.tanks}</td>
                <td className="num mono">{p.peer.raid.deaths}</td>
                <td className="num mono">{pct(p.peer.swingShare)}</td>
                <td className="num mono">{k(p.survivability.effectiveHealth)}</td>
                <td className="num mono">{fmt(p.threat.tps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted small">Raids come from the boss's execution (cleanest kills) and speed (fastest kills) rankings. {a.group.raidsChecked} raids checked.</div>
    </section>
  );
}

export function TankPage({ analysis: a, tab, onTab, onRaid, picker }: { analysis: TankAnalysis; tab: TankTab; onTab: (t: TankTab) => void; onRaid?: () => void; picker?: ReactNode }) {
  return (
    <>
      <TankHeader analysis={a} picker={picker} onRaid={onRaid} />
      <TankKpis analysis={a} />
      {tab === 'Overview' && (
        <>
          <FixFirst analysis={a} onTab={onTab} />
          <div className="grid-2">
            <Findings findings={a.findings.map((f) => ({ ...f, area: f.tab }))} warnings={a.warnings} />
            <PeerMatch analysis={a} onTab={onTab} />
          </div>
          <RowTable title="Compared with peers" subtitle="Gear choices, mitigation, threat and cooldowns: things in your hands." rows={a.judged} peers={a.peers} />
          <RowTable title="Context" subtitle="These depend on the boss, your raid and your role, so they explain differences but aren't judged." rows={a.context} peers={a.peers} />
        </>
      )}
      {tab === 'Survivability' && <Survivability analysis={a} />}
      {tab === 'Swings' && <Swings analysis={a} />}
      {tab === 'Mitigation' && <Mitigation analysis={a} />}
      {tab === 'Threat' && (
        <>
          <Threat analysis={a} />
          <TankOpener analysis={a} />
        </>
      )}
      {tab === 'Cooldowns' && <Cooldowns analysis={a} />}
      {tab === 'Sim' && <TankSim analysis={a} />}
      {tab === 'Peers' && <PeerTable analysis={a} />}
    </>
  );
}
