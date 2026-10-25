import type { SimResult } from '../../../shared/types.ts';
import { fmt, fmtSigned } from '../format.ts';
import { useGroup } from '../group.ts';

/** Compact "what's it worth" summary for the overview. */
export function MiniSim({
  sim,
  loading,
  progress,
  error,
  onOpen,
}: {
  sim?: SimResult;
  loading: boolean;
  progress?: { done: number; total: number };
  error?: string;
  onOpen: () => void;
}) {
  const G = useGroup();
  const gains = sim?.scenarios.filter((s) => s.key !== 'baseline' && s.key !== 'all') ?? [];
  const max = Math.max(...gains.map((s) => Math.abs(s.deltaVsBaseline)), 1);
  const you = sim?.execution.find((e) => !e.rank);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>What it's worth</h2>
          <p className="sub">DPS gained in the sim by swapping in what {G.players} had.</p>
        </div>
        <button className="ghost" onClick={onOpen}>
          Details →
        </button>
      </div>
      {loading && !sim && (
        <div className="row muted small" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="spinner" /> Running WoWSims{progress?.total ? ` in your browser: ${progress.done}/${progress.total} sims` : '…'}
        </div>
      )}
      {error && !sim && <div className="banner error">The sim failed: {error}</div>}
      {sim && (
        <div className="mini-scenarios">
          {gains.map((s) => (
            <div key={s.key} className="mini-scenario">
              <span>{s.label}</span>
              <span className={`num strong ${s.deltaVsBaseline >= 0 ? 'tone-good' : 'tone-bad'}`}>{fmtSigned(s.deltaVsBaseline)}</span>
              <div className="bar-track">
                <div className={`bar ${s.deltaVsBaseline < 0 ? 'neg' : ''}`} style={{ width: `${(Math.abs(s.deltaVsBaseline) / max) * 100}%` }} />
              </div>
            </div>
          ))}
          <div className="muted small">Your setup sims at {fmt(sim.scenarios[0].dps)} DPS.</div>
          {you && (
            <div className="muted small">
              Luck:{' '}
              <span className={you.luck.luckDps >= 0 ? 'tone-good' : 'tone-bad'}>
                {fmtSigned(you.luck.luckDps)} DPS ({fmtSigned(you.luck.luckPct, 1)}%)
              </span>{' '}
              · crit {fmt(you.luck.critPct, 1)}% vs {fmt(you.luck.expectedCritPct, 1)}% expected
            </div>
          )}
        </div>
      )}
    </section>
  );
}
