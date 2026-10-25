import type { SimResult } from '../../../shared/types.ts';
import { fmt, fmtSigned } from '../format.ts';
import { game } from '../game.ts';
import { ExecutionChart } from './ExecutionChart.tsx';
import { LuckPanel } from './LuckPanel.tsx';
import { useGroup } from '../group.ts';

interface Props {
  sim?: SimResult;
  loading: boolean;
  /** Browser sims: done so far / handed out so far (more come as earlier ones finish). */
  progress?: { done: number; total: number };
  error?: string;
  onRetry: () => void;
}

export function SimPanel({ sim, loading, progress, error, onRetry }: Props) {
  const G = useGroup();
  if (loading && !sim) {
    return (
      <section className="loading">
        <div className="spinner" />
        <div>
          <strong>Running WoWSims scenarios…</strong>
          <div className="muted small">
            {progress?.total
              ? `In your browser: ${progress.done} of ${progress.total} sims so far (more follow as these finish). Usually 10–40 seconds.`
              : game.simMode === 'browser'
                ? 'Loading the sim (7 MB the first time)…'
                : 'On the server, a few seconds.'}
          </div>
        </div>
      </section>
    );
  }
  if (error) {
    return (
      <section className="panel">
        <div className="banner error">{error}</div>
        <div>
          <button onClick={onRetry}>Try again</button>
        </div>
      </section>
    );
  }
  if (!sim) return null;

  const base = sim.scenarios[0];
  const you = sim.execution.find((e) => !e.rank);
  const maxGain = Math.max(...sim.scenarios.map((s) => Math.abs(s.deltaVsBaseline)), 1);

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>What would change your DPS?</h2>
            <p className="sub">
              Your character simmed with one thing swapped for what {G.players} had ({fmt(sim.iterations)} iterations each). Bars show the DPS gained over your own setup.
            </p>
          </div>
          <span className="pill acc">Your setup: {fmt(base.dps)} DPS</span>
        </div>
        <div>
          {sim.scenarios.slice(1).map((s) => (
            <div key={s.key} className="scenario">
              <div>
                <div className="strong">{s.label}</div>
                <div className="muted small">{s.description}</div>
                {s.changes && (
                  <details className="changes">
                    <summary>{s.changes.length ? `What changed (${s.changes.length})` : 'Nothing to change: you already had all of it'}</summary>
                    {s.changes.length > 0 && (
                      <ul>
                        {s.changes.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    )}
                  </details>
                )}
              </div>
              <div className="bar-track">
                <div className={`bar ${s.deltaVsBaseline < 0 ? 'neg' : ''}`} style={{ width: `${(Math.abs(s.deltaVsBaseline) / maxGain) * 100}%` }} />
              </div>
              <div className="num">
                <div className={`strong ${s.deltaVsBaseline >= 0 ? 'tone-good' : 'tone-bad'}`}>{fmtSigned(s.deltaVsBaseline)} DPS</div>
                <div className="muted small">{fmtSigned((s.deltaVsBaseline / base.dps) * 100, 1)}%</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <ExecutionChart execution={sim.execution} />

      {you && <LuckPanel you={you} top={sim.execution.filter((e) => e.rank)} knockOn={sim.knockOn ?? 'crit-triggered effects'} />}

      <details className="panel setup-notes">
        <summary>
          <h2>How the sim was set up</h2>
          <span className="muted small">Raid buffs, talents and assumptions ({sim.notes.length})</span>
        </summary>
        <div className="notes">
          <ul>
            {sim.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      </details>
    </>
  );
}
