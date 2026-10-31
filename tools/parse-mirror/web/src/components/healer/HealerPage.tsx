import type { ReactNode } from 'react';

import { median } from '../../../../server/analysis/stats.ts';
import type { HealerAnalysis, HealerTab } from '../../../../shared/types.ts';
import { fmt, fmtDate, fmtTime, wclUrl } from '../../format.ts';
import { Findings } from '../Findings.tsx';
import { Kpi } from '../SummaryCards.tsx';
import { CooldownList, ManaChart, ManaSources, OverhealBars } from './HealerCharts.tsx';
import { HealerScorePanel } from './HealerScore.tsx';
import { DeathList, PeerTable, RowTable, SpellTable, fmtRow, iconOf, pct, rowTone } from './HealerTables.tsx';

export const HEALER_TABS: HealerTab[] = ['Overview', 'Mana', 'Spells', 'Overheal', 'Response', 'Deaths', 'Peers'];

const ROLE: Record<HealerAnalysis['you']['role'], string> = { tank: 'Tank healer', mixed: 'Tanks and raid', raid: 'Raid healer' };
const MATCH: Record<HealerAnalysis['group']['match'], { label: string; pill: string }> = {
  close: { label: 'Close match', pill: 'ok' },
  loose: { label: 'Looser match', pill: 'acc' },
  assignment: { label: 'Closest assignment', pill: 'warn' },
  none: { label: 'No peers found', pill: 'bad' },
};

function HealerHeader({ analysis: a, picker, onRaid }: { analysis: HealerAnalysis; picker?: ReactNode; onRaid?: () => void }) {
  const you = a.you;
  const top = you.topTargets[0];
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
          <span className="pill acc" title="Share of your effective healing that went to the players tanking the boss.">
            {ROLE[you.role]} · {pct(you.tankShare)} on tanks
          </span>
          {top && (
            <span className="pill">
              Most on {top.name} ({pct(top.share)})
            </span>
          )}
          <span className="pill">
            {a.raid.healers} healers · {fmt(a.raid.dtps / Math.max(1, a.raid.healers))} damage/s each
          </span>
        </div>
      </div>
      <div className="head-actions report-actions">
        {picker}
        {onRaid && (
          <button className="btn" onClick={onRaid} title={`${you.name} on every boss in this raid`}>
            Whole raid →
          </button>
        )}
        <a className="btn" href={`${wclUrl(a.report, a.fight, you.source).replace('type=damage-done', 'type=healing')}`} target="_blank" rel="noreferrer">
          Warcraft Logs ↗
        </a>
      </div>
    </section>
  );
}

function HealerKpis({ analysis: a }: { analysis: HealerAnalysis }) {
  const row = (key: string) => [...a.judged, ...a.context].find((r) => r.key === key);
  const kpi = (key: string, label: string, hint?: string) => {
    const r = row(key);
    if (!r) return null;
    const tone = rowTone(r);
    return (
      <Kpi
        label={label}
        hint={hint ?? r.hint}
        value={fmtRow(r.format, r.you)}
        sub={`Peer median ${fmtRow(r.format, r.median)}`}
        delta={tone === 'neutral' ? undefined : r.you !== null && r.median !== null ? (r.format === 'pct' ? (r.you - r.median) * 100 : r.you - r.median) : undefined}
        deltaUnit={r.format === 'pct' ? ' pts' : r.format === 'sec' ? ' s' : ''}
        digits={r.format === 'dec' || r.format === 'sec' ? 1 : 0}
        good={tone === 'good'}
      />
    );
  };
  const hps = row('hps');
  return (
    <section className="kpis">
      {kpi('hpm', 'Healing per mana')}
      {kpi('ownOverheal', 'Overheal by choice')}
      {kpi('potions', 'Potions & runes', 'Mana potions and Dark/Demonic Runes used on this kill.')}
      {kpi('idle', 'Idle while needed')}
      {hps && (
        <Kpi
          label="HPS"
          hint="Depends on how many healers your raid brings and how much damage it takes, so it isn't judged."
          value={fmt(hps.you ?? 0)}
          sub={`Peer median ${fmt(hps.median ?? 0)} · not judged`}
        />
      )}
    </section>
  );
}

/** The three changes most worth making, with a jump to the tab that shows them. */
function HealerFixFirst({ analysis: a, onTab }: { analysis: HealerAnalysis; onTab: (t: HealerTab) => void }) {
  const items = a.findings.filter((f) => f.severity === 'high' || f.severity === 'medium').slice(0, 3);
  if (!items.length) return null;
  return (
    <section className="panel fix-first">
      <div className="panel-head">
        <div>
          <h2>Fix first</h2>
          <p className="sub">The changes most likely to make your healing count for more, judged only on what your raid doesn't decide for you.</p>
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

/** How the peers were picked, and how close their raids are to yours. */
function PeerMatch({ analysis: a, onTab }: { analysis: HealerAnalysis; onTab: (t: HealerTab) => void }) {
  const g = a.group;
  const peers = a.peers;
  const yourPerHealer = a.raid.dtps / Math.max(1, a.raid.healers);
  const theirPerHealer = median(peers.map((p) => p.peer.raid.dtpsPerHealer));
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Who you're compared with</h2>
          <p className="sub">{g.description}</p>
        </div>
        <span className={`pill ${MATCH[g.match].pill}`}>{MATCH[g.match].label}</span>
      </div>
      {peers.length > 0 && (
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
              <td>Healers in the raid</td>
              <td className="num mono">{a.raid.healers}</td>
              <td className="num mono">{median(peers.map((p) => p.peer.raid.healers))}</td>
            </tr>
            <tr>
              <td>Damage taken per healer per second</td>
              <td className="num mono">{fmt(yourPerHealer)}</td>
              <td className="num mono">{fmt(theirPerHealer)}</td>
            </tr>
            <tr>
              <td>Deaths</td>
              <td className="num mono">{a.deaths.length}</td>
              <td className="num mono">{median(peers.map((p) => p.peer.raid.deaths))}</td>
            </tr>
            <tr>
              <td>Healing on tanks</td>
              <td className="num mono">{pct(a.you.tankShare)}</td>
              <td className="num mono">{pct(median(peers.map((p) => p.tankShare)))}</td>
            </tr>
          </tbody>
        </table>
      )}
      {theirPerHealer > 0 && yourPerHealer > theirPerHealer * 1.15 && (
        <div className="notes small">
          Your raid took {pct(yourPerHealer / theirPerHealer - 1)} more damage per healer than theirs. More to heal usually means less overheal and higher HPS for you,
          so those aren't judged.
        </div>
      )}
      <button className="ghost small" onClick={() => onTab('Peers')}>
        See the peers →
      </button>
    </section>
  );
}

const RESPONSE_KEYS = ['reaction', 'first', 'saves', 'idle', 'cancelLost', 'preheal'];

export function HealerPage({
  analysis: a,
  tab,
  onTab,
  onRaid,
  picker,
}: {
  analysis: HealerAnalysis;
  tab: HealerTab;
  onTab: (t: HealerTab) => void;
  onRaid?: () => void;
  picker?: ReactNode;
}) {
  return (
    <>
      <HealerHeader analysis={a} picker={picker} onRaid={onRaid} />
      <HealerKpis analysis={a} />
      {tab === 'Overview' && (
        <>
          <HealerScorePanel analysis={a} />
          <HealerFixFirst analysis={a} onTab={onTab} />
          <div className="grid-2">
            <Findings findings={a.findings.map((f) => ({ ...f, area: f.tab }))} warnings={a.warnings} />
            <PeerMatch analysis={a} onTab={onTab} />
          </div>
          <RowTable title="Compared with peers" subtitle="Things in your hands, whatever the raid around you." rows={a.judged} peers={a.peers} />
          <RowTable
            title="Context"
            subtitle="These depend on your raid (how many healers, how much damage), so they explain differences but aren't judged."
            rows={a.context}
            peers={a.peers}
          />
        </>
      )}
      {tab === 'Mana' && (
        <>
          <ManaChart analysis={a} />
          <div className="grid-2">
            <CooldownList analysis={a} />
            <ManaSources analysis={a} />
          </div>
        </>
      )}
      {tab === 'Spells' && <SpellTable analysis={a} />}
      {tab === 'Overheal' && <OverhealBars analysis={a} />}
      {tab === 'Response' && (
        <>
          <RowTable
            title="Reacting and saving"
            subtitle="How quickly you answer someone dropping, the saves you made, and time lost to idling or cancelled casts."
            rows={a.judged.filter((r) => RESPONSE_KEYS.includes(r.key))}
            peers={a.peers}
          />
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Cancelled casts</h2>
                <p className="sub">
                  {a.you.cancels.count} of {a.you.cancels.started} casts you started were cancelled, costing {a.you.cancels.secLost.toFixed(1)} s.{' '}
                  {a.you.cancels.likelyTopped > 0 &&
                    `${a.you.cancels.likelyTopped} look deliberate: the player you'd just healed was topped up by then, so stopping saved the mana.`}
                </p>
              </div>
            </div>
          </section>
        </>
      )}
      {tab === 'Deaths' && <DeathList analysis={a} />}
      {tab === 'Peers' && <PeerTable analysis={a} />}
    </>
  );
}
