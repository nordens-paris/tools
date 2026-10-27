import { useEffect, useState } from 'react';

import type { TankAnalysis, TankSimResult } from '../../../../shared/types.ts';
import { runSim } from '../../api.ts';
import { runBrowserSims } from '../../browserSims.ts';
import { fmt, fmtSigned } from '../../format.ts';
import { game } from '../../game.ts';
import { Hint } from '../Hint.tsx';

// Results and runs by analysis id, so switching tabs doesn't sim again.
const results = new Map<string, TankSimResult>();
const running = new Map<string, Promise<TankSimResult>>();
type Progress = { done: number; total: number };
const listeners = new Map<string, (p: Progress) => void>();

function simulate(id: string): Promise<TankSimResult> {
  let run = running.get(id);
  if (!run) {
    run = (game.simMode === 'browser' ? runBrowserSims<TankSimResult>(id, (done, total) => listeners.get(id)?.({ done, total })) : runSim<TankSimResult>(id))
      .then((r) => {
        results.set(id, r);
        return r;
      })
      .finally(() => running.delete(id));
    running.set(id, run);
  }
  return run;
}

const ROLE = { main: 'Main', off: 'Off', adds: 'Adds' } as const;
const pctText = (v: number) => `${Math.round(v)}%`;
const tone = (relative: number) => (relative >= 97 ? 'tone-good' : relative < 85 ? 'tone-bad' : '');

export function TankSim({ analysis: a }: { analysis: TankAnalysis }) {
  const [sim, setSim] = useState<TankSimResult | undefined>(() => results.get(a.id));
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState<Progress>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (results.has(a.id)) {
      setSim(results.get(a.id));
      return;
    }
    let live = true;
    setSim(undefined);
    setError(undefined);
    listeners.set(a.id, (p) => live && setProgress(p));
    simulate(a.id).then(
      (r) => live && setSim(r),
      (err) => live && setError((err as Error).message),
    );
    return () => {
      live = false;
    };
  }, [a.id, attempt]);

  if (error) {
    return (
      <section className="panel">
        <div className="banner error">{error}</div>
        <div>
          {/* The server forgot the analysis (it restarted): only a fresh analysis can sim again. */}
          {error.startsWith('Analysis not found') ? <button onClick={() => window.location.reload()}>Run the analysis again</button> : <button onClick={() => setAttempt((n) => n + 1)}>Try again</button>}
        </div>
      </section>
    );
  }
  if (!sim) {
    return (
      <section className="loading">
        <div className="spinner" />
        <div>
          <strong>Running WoWSims tank sims…</strong>
          <div className="muted small">
            {progress?.total
              ? `In your browser: ${progress.done} of ${progress.total} sims so far. Usually under a minute.`
              : 'Fetching every tank’s gear and buffs from Warcraft Logs, then loading the sim (7 MB the first time)…'}
          </div>
        </div>
      </section>
    );
  }

  const you = sim.players.find((p) => p.you);
  const hasPeers = sim.players.some((p) => !p.you);
  const base = sim.scenarios[0];
  const swaps = sim.scenarios.slice(1);
  const max = Math.max(...sim.players.map((p) => Math.max(p.actualTps, p.simTps)), 1);
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Threat next to what your gear can do</h2>
            <p className="sub">
              Each tank simmed with their own gear, talents and raid buffs, tanking this boss with the WoWSims rotation ({fmt(sim.iterations)} iterations). The sim is a perfect player, so everyone lands below 100%; what matters is your
              percentage next to the peers'.
            </p>
          </div>
          {you && hasPeers && (
            <span className={`pill ${you.relativePct >= 97 ? 'ok' : you.relativePct < 85 ? 'bad' : 'acc'}`} title="Your threat ÷ sim, next to the peers' median.">
              {pctText(you.relativePct)} of the peers
            </span>
          )}
        </div>
        <div className="table-scroll">
          <table className="t">
            <thead>
              <tr>
                <th>Tank</th>
                <th>Role</th>
                <th className="num">
                  Threat
                  <Hint text="Threat per second on the boss in the log." />
                </th>
                <th className="num">Sim</th>
                <th className="num">
                  Of sim
                  <Hint text="Your threat ÷ the sim's: how much of your gear's threat you got out." />
                </th>
                <th className="num">
                  vs peers
                  <Hint text="Of sim, next to the peers' median (100% = like the peers). This cancels anything the sim gets wrong for everyone." />
                </th>
                <th className="num">
                  Opener
                  <Hint text="Threat per second over 10 s from your first attack (the sim starts fighting at once): the log, the sim, and the log as a share of the sim." />
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sim.players.map((p) => (
                <tr key={p.name} className={p.you ? 'you' : ''}>
                  <td>{p.you ? `${p.name} (you)` : p.name}</td>
                  <td className="small">
                    {ROLE[p.role]} <span className="muted">· {pctText(p.swingShare * 100)}</span>
                  </td>
                  <td className="num mono">{fmt(p.actualTps)}</td>
                  <td className="num mono muted">{fmt(p.simTps)}</td>
                  <td className="num mono">{pctText(p.threatPct)}</td>
                  <td className={`num mono strong ${hasPeers ? tone(p.relativePct) : ''}`}>{hasPeers ? pctText(p.relativePct) : '–'}</td>
                  <td className="num mono small">
                    {fmt(p.actualOpenerTps)} / {fmt(p.simOpenerTps)} <span className="muted">({pctText(p.openerPct)})</span>
                  </td>
                  <td style={{ width: '18%' }}>
                    <div className="ov-track" style={{ height: 8 }}>
                      <div className={`ov-seg ${p.you ? 'ov-others' : 'ov-hot'}`} style={{ width: `${(p.actualTps / max) * 100}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Damage taken from the boss's melee</h2>
            <p className="sub">
              Per second while tanking it: the log next to the sim, which keeps your active mitigation and debuffs up perfectly and has no healing. Taking clearly more than the sim points at mitigation that was down, crushing blows or
              debuffs missing on the boss; taking less is usually avoidance luck or the boss swinging at others.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="t">
            <thead>
              <tr>
                <th>Tank</th>
                <th className="num">Log</th>
                <th className="num">Sim</th>
                <th className="num">Log ÷ sim</th>
              </tr>
            </thead>
            <tbody>
              {sim.players.map((p) => (
                <tr key={p.name} className={p.you ? 'you' : ''}>
                  <td>{p.you ? `${p.name} (you)` : p.name}</td>
                  <td className="num mono">{fmt(p.actualDtps)}</td>
                  <td className="num mono muted">{fmt(p.simDtps)}</td>
                  <td className={`num mono ${p.simDtps && p.actualDtps / p.simDtps > 1.15 ? 'tone-bad' : ''}`}>{p.simDtps ? pctText((p.actualDtps / p.simDtps) * 100) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {swaps.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Your setup with a peer's gear</h2>
              <p className="sub">Threat and damage taken trade off: more threat usually means less armor and stamina. Your talents, consumes and raid buffs stay the same.</p>
            </div>
            <span className="pill acc">
              Your setup: {fmt(base.tps)} TPS · {fmt(base.dtps)} DTPS
            </span>
          </div>
          <div>
            {swaps.map((s) => (
              <div key={s.key} className="scenario two-num">
                <div>
                  <div className="strong">{s.label}</div>
                  <div className="muted small">{s.description}</div>
                  {s.changes && (
                    <details className="changes">
                      <summary>{s.changes.length ? `What changed (${s.changes.length})` : 'Same gear as yours'}</summary>
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
                <div className="num">
                  <div className={`strong ${s.deltaTps >= 0 ? 'tone-good' : 'tone-bad'}`}>{fmtSigned(s.deltaTps)} TPS</div>
                  <div className="muted small">{s.openerTps !== undefined && base.openerTps !== undefined ? `${fmtSigned(s.openerTps - base.openerTps)} opener` : ''}</div>
                </div>
                <div className="num">
                  <div className={`strong ${s.deltaDtps <= 0 ? 'tone-good' : 'tone-bad'}`}>{fmtSigned(s.deltaDtps)} DTPS</div>
                  <div className="muted small">{fmtSigned((s.deltaDtps / (base.dtps || 1)) * 100, 1)}% damage taken</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {sim.warnings.length > 0 && <div className="banner info">{sim.warnings.join(' · ')}</div>}

      <details className="panel setup-notes">
        <summary>
          <h2>How the sim was set up</h2>
          <span className="muted small">The boss, raid buffs, talents and assumptions ({sim.notes.length})</span>
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
