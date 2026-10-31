import type { ProgressSummary } from '../../../shared/types.ts';
import { specIcon } from '../brand.ts';
import { downloadCsv } from '../csv.ts';
import { fmt, fmtSigned, wclUrl } from '../format.ts';
import { Hint } from './Hint.tsx';
import { classIcon } from './RaidChecks.tsx';
import { pctClass } from './RaidOverview.tsx';

type Kill = ProgressSummary['bosses'][number]['kills'][number];

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : undefined);

/** The latest kill's parse minus the one before it. */
function change(kills: Kill[]) {
  return kills.length >= 2 ? kills.at(-1)!.percentile - kills.at(-2)!.percentile : undefined;
}

const date = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** Parse per kill, oldest to newest: a dot in its parse colour per kill, hover for the details. */
function Sparkline({ kills, unit }: { kills: Kill[]; unit: string }) {
  const w = 220;
  const h = 36;
  const x = (i: number) => (kills.length === 1 ? w / 2 : 5 + (i / (kills.length - 1)) * (w - 10));
  const y = (p: number) => h - 5 - (p / 100) * (h - 10);
  const last = kills.at(-1)!;
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Parses from ${fmt(kills[0].percentile)} to ${fmt(last.percentile)}`}>
      <line x1="0" x2={w} y1={y(50)} y2={y(50)} className="spark-mid" />
      {kills.length > 1 && <polyline points={kills.map((k, i) => `${x(i)},${y(k.percentile)}`).join(' ')} className="spark-line" />}
      {kills.map((k, i) => (
        <circle key={i} cx={x(i)} cy={y(k.percentile)} r={i === kills.length - 1 ? 4 : 3} className={`${pctClass(k.percentile)} ${i === kills.length - 1 ? 'last' : ''}`}>
          <title>{`${date(k.startTime)}: parse ${fmt(k.percentile)}, ${fmt(k.dps)} ${unit}, ${fmt(k.durationSec)} s${k.itemLevel ? `, ilvl ${fmt(k.itemLevel)}` : ''}`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** One character's parses on each boss of the raid tier over time. */
export function Progress({ progress }: { progress: ProgressSummary }) {
  const { player, bosses } = progress;
  const unit = progress.metric.toUpperCase();
  const [className, specName = ''] = player.icon.split('-');
  const changes = bosses.map((b) => change(b.kills)).filter((t): t is number => t !== undefined);
  const overall = avg(changes);
  const latest = bosses.map((b) => b.kills.at(-1)!).filter(Boolean);
  const kills = bosses.reduce((n, b) => n + b.kills.length, 0);
  const withIlvl = bosses.flatMap((b) => b.kills).filter((k) => k.itemLevel).sort((a, b) => a.startTime - b.startTime);

  const exportCsv = () =>
    downloadCsv(`${player.name}-progress.csv`, [
      ['Boss', 'Date', 'Parse', unit, 'Kill time (s)', 'Item level', 'Spec', 'Report'],
      ...bosses.flatMap((b) => b.kills.map((k) => [b.name, new Date(k.startTime).toISOString().slice(0, 10), k.percentile, k.dps, k.durationSec, k.itemLevel, k.spec, k.report])),
    ]);

  return (
    <>
      <section className="report-head">
        {specName && <img className="spec-icon" src={specIcon(className, specName)} alt="" onError={(e) => (e.currentTarget.src = classIcon(player.icon))} />}
        <div className="report-title">
          <div className="eyebrow">Progress over time{player.region ? ` · ${player.region}` : ''}</div>
          <h1>
            {player.name}
            {player.server && <span className="server">{player.server}</span>}
          </h1>
          <div className="report-meta">
            <span className="pill acc">{bosses.length} bosses</span>
            <span className="pill">{kills} ranked kills</span>
          </div>
        </div>
        <div className="head-actions">
          <button onClick={exportCsv}>Export CSV</button>
        </div>
      </section>

      {bosses.length === 0 ? (
        <section className="panel">
          <p className="muted">No ranked kills found for this character in this raid tier.</p>
        </section>
      ) : (
        <>
          <section className="kpis three">
            <div className="kpi">
              <span className="eyebrow">Latest kills</span>
              <span className={`kpi-value ${pctClass(avg(latest.map((k) => k.percentile))!)}`}>{fmt(avg(latest.map((k) => k.percentile))!)}</span>
              <span className="kpi-sub">Average parse, most recent kill of each boss</span>
            </div>
            <div className="kpi">
              <span className="eyebrow">
                Latest change
                <Hint text="Each boss's latest parse minus the kill before it, averaged over the bosses with at least two kills." />
              </span>
              <span className={`kpi-value ${overall === undefined ? '' : overall >= 0 ? 'tone-good' : 'tone-bad'}`}>{overall === undefined ? '–' : fmtSigned(overall)}</span>
              <span className="kpi-sub">{overall === undefined ? 'Needs two kills of a boss' : `parse points vs the kill before, over ${changes.length} bosses`}</span>
            </div>
            <div className="kpi">
              <span className="eyebrow">Item level</span>
              <span className="kpi-value">
                {withIlvl.length ? `${fmt(withIlvl[0].itemLevel!)}→${fmt(withIlvl.at(-1)!.itemLevel!)}` : '–'}
              </span>
              <span className="kpi-sub">First ranked kill to now</span>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Every boss</h2>
                <p className="sub">Parse on each kill, oldest to newest, in Warcraft Logs colours (the dashed line is the 50th percentile). Hover a dot for the kill; click the latest parse to open that log.</p>
              </div>
            </div>
            <div className="table-scroll">
              <table className="t">
                <thead>
                  <tr>
                    <th>Boss</th>
                    <th>Parses</th>
                    <th className="num">Kills</th>
                    <th className="num">Best</th>
                    <th className="num">Latest</th>
                    <th className="num">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {bosses.map((b) => {
                    const last = b.kills.at(-1)!;
                    const best = Math.max(...b.kills.map((k) => k.percentile));
                    const t = change(b.kills);
                    return (
                      <tr key={b.encounterId}>
                        <td className="strong">{b.name}</td>
                        <td>
                          <Sparkline kills={b.kills} unit={unit} />
                        </td>
                        <td className="num mono">{b.kills.length}</td>
                        <td className={`num mono ${pctClass(best)}`}>{fmt(best)}</td>
                        <td className={`num mono strong ${pctClass(last.percentile)}`}>
                          <a href={wclUrl(last.report, last.fight)} target="_blank" rel="noreferrer" title={`${date(last.startTime)} · ${fmt(last.dps)} ${unit}`}>
                            {fmt(last.percentile)}
                          </a>
                        </td>
                        <td className={`num mono ${t === undefined ? 'muted' : t >= 0 ? 'tone-good' : 'tone-bad'}`}>{t === undefined ? '–' : fmtSigned(t)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
