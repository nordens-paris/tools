import { Fragment } from 'react';

import type { TankAnalysis, TankMetrics, TankOpenerAction, TankOpenerVerdict } from '../../../../shared/types.ts';
import { abilityIcon, fmt } from '../../format.ts';
import { Hint } from '../Hint.tsx';

const OUTCOME_CLASS: Partial<Record<TankOpenerAction['outcome'], string>> = {
  crit: 'sw-crit',
  hit: 'sw-hit',
  block: 'sw-block',
  glance: 'sw-hit',
  parry: 'sw-parry',
  dodge: 'sw-dodge',
  miss: 'sw-miss',
  resist: 'sw-miss',
};
const VERDICT: Record<TankOpenerVerdict['verdict'], { cls: string; text: string }> = {
  fine: { cls: 'lucky', text: 'Your opening threat is on par with the peers.' },
  start: { cls: 'unlucky', text: 'Your opening threat was low, mostly because you started fighting later than the peers.' },
  luck: { cls: '', text: 'Your opening threat was low, mostly from bad luck.' },
  rotation: { cls: 'unlucky', text: 'Your opening threat was low, mostly from the rotation and gear once you were fighting.' },
  mixed: { cls: 'unlucky', text: 'Your opening threat was low: a later start, luck and the rotation each played a part.' },
};
const sec = (v?: number | null) => (v === undefined || v === null ? '–' : `${v.toFixed(1)} s`);
const per = (m: TankMetrics, v: number) => v / m.opener.windowSec;

/** The abilities a tank used most in the opener (not auto attacks), most-used first. */
const openedWith = (m: TankMetrics) =>
  Object.entries(m.opener.abilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
    .join(', ');

function GapSplit({ v }: { v: TankOpenerVerdict }) {
  const parts = [
    { label: 'Later start', v: v.parts.start },
    { label: 'Luck', v: v.parts.luck },
    { label: 'Rotation and gear', v: v.parts.rotation },
  ];
  return (
    <div className="gap-split">
      <span className="muted small">Of the {fmt(v.peerTps - v.tps)} TPS gap, about:</span>
      {parts.map((p) => (
        <span key={p.label} className={`pill ${p.v >= 50 ? 'bad' : p.v <= -50 ? 'ok' : ''}`}>
          {p.label} {p.v >= 0 ? fmt(p.v) : `−${fmt(-p.v)}`}
        </span>
      ))}
    </div>
  );
}

export function TankOpener({ analysis: a }: { analysis: TankAnalysis }) {
  const you = a.you;
  const o = you.opener;
  const v = a.openerVerdict;
  const startAt = o.startSec ?? 0;
  const melee = o.actions.filter((x) => x.name === 'Melee' && x.t >= startAt);
  const meleeAvoided = melee.filter((x) => x.lost !== undefined).length;
  const actions = o.actions.filter((x) => x.name !== 'Melee');
  const firstFighting = actions.findIndex((x) => x.t >= startAt);
  const rows = [{ name: `${you.name} (you)`, m: you, you: true }, ...a.peers.map((p) => ({ name: p.name, m: p as TankMetrics, you: false }))];
  const luck = per(you, o.luckThreat);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Your opener</h2>
          <p className="sub">
            Threat from the pull is what the DPS can open on. The rest is measured over {o.windowSec} seconds from your first attack: attacks missed, dodged or parried and fewer crits than your usual rate (the rest of the kill) are bad
            luck; unused global cooldowns and weaker abilities are the rotation.
          </p>
        </div>
      </div>
      {v ? (
        <div className={`verdict ${VERDICT[v.verdict].cls}`}>
          <strong>{VERDICT[v.verdict].text}</strong>
          {v.verdict !== 'fine' && <GapSplit v={v} />}
          {v.reasons.length > 0 && (
            <ul>
              {v.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="verdict">{you.role === 'off' ? 'You were the off-tank on this kill, so your opener depends on when the boss came to you: shown, not judged.' : 'Too few peers to judge the opener; your numbers are below.'}</div>
      )}
      <div className="luck-grid">
        <div className="luck-stat">
          <span className="eyebrow">
            From the pull
            <Hint text={`Threat per second over the first ${o.windowSec} s of the kill: what the DPS can open on.`} />
          </span>
          <span className="v">{fmt(per(you, o.pullThreat))}</span>
          <span className="muted small">{v ? `Peers ${fmt(v.peerTps)} TPS` : 'TPS'}</span>
        </div>
        <div className="luck-stat">
          <span className="eyebrow">
            From your first attack
            <Hint text={`Threat per second over ${o.windowSec} s from your first attack. "Usual luck" adds back what bad luck cost (or takes off what good luck gave).`} />
          </span>
          <span className="v">{fmt(per(you, o.threat))}</span>
          <span className="muted small">
            Usual luck {fmt(per(you, o.threat) + luck)}
            {v ? ` · peers ${fmt(v.peerEngagedTps)}` : ''}
          </span>
        </div>
        <div className="luck-stat">
          <span className="eyebrow">
            First attack
            <Hint text="When your first attack (auto attacks included) landed, and when the boss first swung at you, after the pull." />
          </span>
          <span className={`v ${v?.start.peers !== undefined && o.startSec !== undefined && o.startSec > v.start.peers + 1 ? 'tone-bad' : ''}`}>{sec(o.startSec)}</span>
          <span className="muted small">
            Boss's first swing {sec(o.bossSwingSec)}
            {v?.start.peers !== undefined ? ` · peers ${sec(v.start.peers)} / ${sec(v.start.bossPeers)}` : ''}
          </span>
        </div>
        <div className="luck-stat">
          <span className="eyebrow">
            Bad luck cost
            <Hint text="Threat per second lost to attacks avoided beyond your usual rate, and to fewer crits than your usual rate, at what each ability usually does. Negative: good luck." />
          </span>
          <span className={`v ${luck >= 30 ? 'tone-bad' : luck <= -30 ? 'tone-good' : ''}`}>{luck >= 0 ? fmt(luck) : `−${fmt(-luck)}`}</span>
          <span className="muted small">
            Avoided {o.avoided}/{o.attacks} (≈{o.expectedAvoided.toFixed(1)}) · crits {o.crits}/{o.landed} (≈{o.expectedCrits.toFixed(1)})
          </span>
        </div>
      </div>
      <div className="table-scroll">
        <table className="t compact">
          <thead>
            <tr>
              <th className="num">Time</th>
              <th>Ability</th>
              <th>Outcome</th>
              <th className="num">Threat</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((x, i) => (
              <Fragment key={i}>
                {i === firstFighting && o.startSec !== undefined && o.startSec > 0.5 && (
                  <tr className="divider">
                    <td className="num mono nowrap">{sec(o.startSec)}</td>
                    <td colSpan={3} className="small">
                      Your first attack{o.actions.find((y) => y.attack)?.name === 'Melee' ? ' (an auto attack)' : ''}: the {o.windowSec} s of fighting start here
                    </td>
                  </tr>
                )}
              <tr className={x.t < startAt ? 'muted' : ''}>
                <td className="num mono nowrap">{x.t.toFixed(1)} s</td>
                <td>
                  <span className="spell-name small">
                    {x.icon && <img src={abilityIcon(x.icon)} alt="" />}
                    {x.name}
                    {!x.gcd && x.outcome === 'cast' && <span className="muted"> · off GCD</span>}
                  </span>
                </td>
                <td className="small nowrap">
                  {OUTCOME_CLASS[x.outcome] && <i className={`sw ${OUTCOME_CLASS[x.outcome]}`} />} {x.outcome === 'cast' ? <span className="muted">cast</span> : x.outcome}
                  {!x.attack && x.outcome !== 'cast' && <span className="muted"> · buff</span>}
                </td>
                <td className={`num mono ${x.lost !== undefined ? 'tone-bad' : ''}`}>{x.lost !== undefined ? `−${fmt(x.lost)}` : x.threat ? fmt(x.threat) : '–'}</td>
              </tr>
              </Fragment>
            ))}
            <tr>
              <td />
              <td className="muted small">Auto attacks</td>
              <td className="small">
                {melee.length} swings{meleeAvoided ? `, ${meleeAvoided} avoided` : ''}
              </td>
              <td className="num mono">{fmt(melee.reduce((s, x) => s + x.threat, 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="muted small">Greyed: before your first attack. In red: what an avoided attack usually does when it lands. "Buff": damage from a buff on you (Thorns, Blessing of Sanctuary), not one of your attacks.</div>
      {a.peers.length > 0 && (
        <div className="table-scroll">
          <table className="t compact">
            <thead>
              <tr>
                <th>Tank</th>
                <th className="num">
                  From pull
                  <Hint text="Threat per second over the first 10 s of the kill." />
                </th>
                <th className="num">
                  From 1st attack
                  <Hint text="Threat per second over 10 s from their first attack, with usual luck." />
                </th>
                <th className="num">1st attack</th>
                <th className="num">Boss swing</th>
                <th className="num">Crits</th>
                <th className="num">Avoided</th>
                <th className="num">GCDs</th>
                <th>Opened with</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ro = r.m.opener;
                return (
                  <tr key={r.name} className={r.you ? 'you' : ''}>
                    <td>{r.name}</td>
                    <td className="num mono">{fmt(per(r.m, ro.pullThreat))}</td>
                    <td className="num mono">{fmt(per(r.m, ro.threat + ro.luckThreat))}</td>
                    <td className="num mono">{sec(ro.startSec)}</td>
                    <td className="num mono">{sec(ro.bossSwingSec)}</td>
                    <td className="num mono">
                      {ro.crits}/{ro.landed}
                    </td>
                    <td className="num mono">
                      {ro.avoided}/{ro.attacks}
                    </td>
                    <td className="num mono">
                      {ro.gcds}/{ro.possibleGcds}
                    </td>
                    <td className="small">{openedWith(r.m) || '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
