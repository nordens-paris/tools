import { useState } from 'react';

import type { RaidSummary, TankRaidRow, TankRaidSummary } from '../../../../shared/types.ts';
import { raidTanks } from '../../roles.ts';
import { fmt, fmtTime, medianOf as median, wclUrl } from '../../format.ts';
import { Hint } from '../Hint.tsx';
import { HealerKeyNote, useRolesAllowed } from '../healer/HealerRaid.tsx';
import { iconOf, pct } from '../healer/HealerTables.tsx';

const ROLE = { main: 'Main', off: 'Off', adds: 'Adds' } as const;
const k = (v: number) => `${(v / 1000).toFixed(1)}k`;

/** Tank KPIs over a player's raid. */
export function TankRaidKpis({ raid }: { raid: RaidSummary }) {
  const rows = raid.bosses.map((b) => b.tanking).filter((t): t is TankRaidRow => !!t);
  const ehp = median(rows.map((r) => r.effectiveHealth));
  const crushes = rows.reduce((s, r) => s + r.crushes, 0);
  const swings = rows.reduce((s, r) => s + r.swings, 0);
  const cov = median(rows.map((r) => r.coverage).filter((v): v is number => v !== undefined));
  const opener = median(rows.filter((r) => r.role === 'main').map((r) => r.opener));
  return (
    <section className="kpis four">
      <div className="kpi">
        <span className="eyebrow">
          Effective health
          <Hint text="Median over your kills: health ÷ (1 − armor reduction) against a level 73 boss." />
        </span>
        <span className="kpi-value">{ehp !== undefined ? k(ehp) : '–'}</span>
        <span className="kpi-sub">Median over {rows.length} kills</span>
      </div>
      <div className="kpi">
        <span className="eyebrow">Crushing blows</span>
        <span className="kpi-value">
          {crushes}
          <span className="unit">/ {swings} swings</span>
        </span>
        <span className="kpi-sub">{cov !== undefined ? `Median ${pct(cov)} of swings under Holy Shield / Shield Block` : 'Bears always take some'}</span>
      </div>
      <div className="kpi">
        <span className="eyebrow">Opening threat</span>
        <span className="kpi-value">{opener !== undefined ? fmt(opener) : '–'}</span>
        <span className="kpi-sub">TPS over the first 10 s, median of kills you main tanked</span>
      </div>
      <div className="kpi">
        <span className="eyebrow">Threat dropped</span>
        <span className="kpi-value">{rows.reduce((s, r) => s + r.threatDrops, 0)}</span>
        <span className="kpi-sub">Divine Shield / Blessing of Protection on yourself</span>
      </div>
    </section>
  );
}

/** A tank's boss kills. */
export function TankBossTable({ raid, onOpen, loading }: { raid: RaidSummary; onOpen: (fight: number) => void; loading: boolean }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Boss kills</h2>
          <p className="sub">Your tanking on each kill. Open a boss to compare with tanks of your class and role from well-run raids.</p>
        </div>
      </div>
      <div className="table-scroll">
        <table className="t raid">
          <thead>
            <tr>
              <th>Boss</th>
              <th>Role</th>
              <th className="num">Effective health</th>
              <th className="num">Avoided</th>
              <th className="num">
                Crushes
                <Hint text="Crushing blows taken, of the swings you took. In brackets: share of swings under Holy Shield / Shield Block." />
              </th>
              <th className="num">TPS</th>
              <th className="num">Opener</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {raid.bosses.map((b) => {
              const t = b.tanking;
              return (
                <tr key={b.fight}>
                  <td>
                    <a className="strong" href={wclUrl(raid.report, b.fight, raid.player.source).replace('type=damage-done', 'type=damage-taken')} target="_blank" rel="noreferrer">
                      {b.name}
                    </a>
                    <div className="muted small mono">{fmtTime(b.durationSec)}</div>
                  </td>
                  {t ? (
                    <>
                      <td className="small">
                        {ROLE[t.role]} <span className="muted">· {pct(t.swingShare)}</span>
                        {t.died && <span className="pill bad"> died</span>}
                      </td>
                      <td className="num mono strong">{k(t.effectiveHealth)}</td>
                      <td className="num mono">{pct(t.avoided)}</td>
                      <td className={`num mono ${t.crushes && t.coverage !== undefined ? 'tone-bad' : ''}`}>
                        {t.crushes}/{t.swings}
                        {t.coverage !== undefined && <span className="muted"> ({pct(t.coverage)})</span>}
                      </td>
                      <td className="num mono">{fmt(t.tps)}</td>
                      <td className="num mono">{fmt(t.opener)}</td>
                    </>
                  ) : (
                    <td colSpan={6} className="muted small">
                      Not tanking on this kill
                    </td>
                  )}
                  <td className="num">
                    <button disabled={!t || loading} onClick={() => onOpen(b.fight)}>
                      Analyze
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const VIEWS = [
  { key: 'ehp', label: 'Effective health', get: (r: TankRaidRow) => k(r.effectiveHealth) },
  { key: 'crush', label: 'Crushes', get: (r: TankRaidRow) => `${r.crushes}/${r.swings}` },
  { key: 'cover', label: 'Holy Shield / Shield Block', get: (r: TankRaidRow) => (r.coverage !== undefined ? pct(r.coverage) : '–') },
  { key: 'tps', label: 'TPS', get: (r: TankRaidRow) => fmt(r.tps) },
  { key: 'opener', label: 'Opener', get: (r: TankRaidRow) => fmt(r.opener) },
  { key: 'role', label: 'Role', get: (r: TankRaidRow) => `${ROLE[r.role]} ${pct(r.swingShare)}` },
] as const;

/** Every tank on every boss, loaded on request (3 requests per tank per boss, plus the shared raid data). */
export function TankRaidPanel({ report, onFight }: { report: string; onFight: (fight: number, source: number) => void }) {
  const [data, setData] = useState<TankRaidSummary>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [view, setView] = useState<(typeof VIEWS)[number]['key']>('ehp');
  const allowed = useRolesAllowed();
  const load = async () => {
    setLoading(true);
    setError(undefined);
    try {
      setData(await raidTanks(report));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const tanks = new Map<number, TankRaidRow>();
  for (const b of data?.bosses ?? []) for (const r of b.rows) if (!tanks.has(r.source)) tanks.set(r.source, r);
  const shown = VIEWS.find((v) => v.key === view)!;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Tanks</h2>
          <p className="sub">Each tank on each boss: effective health, crushing blows, active mitigation and threat. Open a cell for the full comparison with tanks from well-run raids.</p>
        </div>
        {data && (
          <div className="segmented" role="group" aria-label="Tank view">
            {VIEWS.map((v) => (
              <button key={v.key} aria-pressed={view === v.key} onClick={() => setView(v.key)}>
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {!data && !allowed && <HealerKeyNote />}
      {!data && allowed && (
        <div>
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? 'Loading tanks…' : 'Show tanks'}
          </button>
          <span className="muted small"> Fetches each boss's tanking from Warcraft Logs, so it takes a little while the first time.</span>
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      {data && (
        <div className="table-scroll">
          <table className="t guild compact">
            <thead>
              <tr>
                <th>Tank</th>
                {data.bosses.map((b) => (
                  <th key={b.fight} className="num" title={b.name}>
                    {b.name.split(' ').at(-1)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...tanks.values()].map((t) => (
                <tr key={t.source}>
                  <td>
                    <span className="spell-name">
                      <img src={iconOf(t.icon)} alt="" />
                      {t.name}
                    </span>
                  </td>
                  {data.bosses.map((b) => {
                    const r = b.rows.find((x) => x.source === t.source);
                    return (
                      <td key={b.fight} className={`num mono ${view === 'crush' && r && r.crushes && r.coverage !== undefined ? 'cell-bad' : ''}`}>
                        {r ? (
                          <button className="link cell" onClick={() => onFight(b.fight, t.source)} title={`${t.name} on ${b.name}${r.died ? ' (died)' : ''}`}>
                            {shown.get(r)}
                          </button>
                        ) : (
                          <span className="muted">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
