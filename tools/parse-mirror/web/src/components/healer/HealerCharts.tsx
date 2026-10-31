import { median } from '../../../../server/analysis/stats.ts';
import type { HealerAnalysis, HealerMetrics } from '../../../../shared/types.ts';
import { fmt, fmtTime } from '../../format.ts';
import { pct } from './HealerTables.tsx';

/** Mana over the kill, as a share of the fight so different kill times line up; peers in grey. */
export function ManaChart({ analysis: a }: { analysis: HealerAnalysis }) {
  // About the panel's width on a desktop, so the 11px labels stay about 11px.
  const w = 1100;
  const h = 260;
  const pad = { l: 34, r: 10, t: 10, b: 24 };
  const x = (frac: number) => pad.l + frac * (w - pad.l - pad.r);
  const y = (p: number) => pad.t + (1 - Math.max(0, Math.min(1, p))) * (h - pad.t - pad.b);
  const line = (m: HealerMetrics, dur: number) => m.mana?.curve.map((c) => `${x(c.t / dur)},${y(c.pct)}`).join(' ') ?? '';
  const you = a.you;
  if (!you.mana) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Mana over the kill</h2>
          <p className="sub">
            Your mana (blue) and the peers' (grey), stretched to the same length so different kill times line up. Dots are your cooldowns and potions.
          </p>
        </div>
        <div className="legend">
          <span>
            <i className="sw" style={{ background: 'var(--accent)' }} /> You
          </span>
          <span>
            <i className="sw" style={{ background: 'var(--range)' }} /> Peers
          </span>
        </div>
      </div>
      <svg className="mana-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Mana from ${pct(you.mana.curve[0]?.pct ?? 1)} to ${pct(you.mana.end)}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <g key={p}>
            <line x1={pad.l} x2={w - pad.r} y1={y(p)} y2={y(p)} className="grid" />
            <text x={pad.l - 6} y={y(p) + 4} className="axis" textAnchor="end">
              {pct(p)}
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <text key={f} x={x(f)} y={h - 6} className="axis" textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>
            {fmtTime(f * a.durationSec)}
          </text>
        ))}
        {a.peers.map((p) => (
          <polyline key={p.name} points={line(p, p.durationSec)} className="peer-line">
            <title>{p.name}</title>
          </polyline>
        ))}
        <polyline points={line(you, a.durationSec)} className="you-line" />
        {you.cooldowns.map((c, i) => (
          <circle key={i} cx={x(c.atSec / a.durationSec)} cy={y(c.manaPct ?? 0.5)} r={4.5} className="cd-dot">
            <title>{`${fmtTime(c.atSec)} ${c.name}${c.from ? ` from ${c.from}` : ''}${c.manaPct !== undefined ? ` at ${pct(c.manaPct)} mana` : ''}`}</title>
          </circle>
        ))}
      </svg>
    </section>
  );
}

/** Where mana came from, you vs the peer median. */
export function ManaSources({ analysis: a }: { analysis: HealerAnalysis }) {
  const names = [...new Set([...a.you.manaGained, ...a.peers.flatMap((p) => p.manaGained)].map((g) => g.name))];
  const amount = (m: HealerMetrics, n: string) => m.manaGained.find((g) => g.name === n)?.amount ?? 0;
  const med = (n: string) => median(a.peers.map((p) => amount(p, n)));
  const rows = names.map((n) => ({ n, you: amount(a.you, n), peers: med(n) })).filter((r) => r.you || r.peers).sort((p, q) => Math.max(q.you, q.peers) - Math.max(p.you, p.peers));
  const max = Math.max(1, ...rows.flatMap((r) => [r.you, r.peers]));
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Mana gained</h2>
          <p className="sub">Potions, runes, totems and talents over the kill, you vs the peer median.</p>
        </div>
      </div>
      <div className="mana-sources">
        {rows.map((r) => (
          <div className="mana-source" key={r.n}>
            <span className="small">{r.n}</span>
            <div className="share-bars">
              <div className="share-bar you" style={{ width: `${(r.you / max) * 100}%` }} />
              <div className="share-bar peer" style={{ width: `${(r.peers / max) * 100}%` }} />
            </div>
            <span className="mono small">
              {fmt(r.you)} <span className="muted">/ {fmt(r.peers)}</span>
            </span>
          </div>
        ))}
      </div>
      {a.you.manaWasted > 0 && <div className="muted small">{fmt(a.you.manaWasted)} mana from these was lost to a full mana bar.</div>}
    </section>
  );
}

/** Cooldowns you used, and how many peers used each. */
export function CooldownList({ analysis: a }: { analysis: HealerAnalysis }) {
  const names = [...new Set([...a.you.cooldowns, ...a.peers.flatMap((p) => p.cooldowns)].map((c) => c.name))];
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Cooldowns and potions</h2>
          <p className="sub">When you used them (and your mana at the time), and how many of the {a.peers.length} peers used each.</p>
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
            const mine = a.you.cooldowns.filter((c) => c.name === n);
            const users = a.peers.filter((p) => p.cooldowns.some((c) => c.name === n)).length;
            return (
              <tr key={n}>
                <td>{n}</td>
                <td className={mine.length ? 'mono small' : 'muted small'}>
                  {mine.length ? mine.map((c) => `${fmtTime(c.atSec)}${c.manaPct !== undefined ? ` (${pct(c.manaPct)})` : ''}${c.from ? ` from ${c.from}` : ''}`).join(', ') : 'not used'}
                </td>
                <td className={`num mono ${!mine.length && users >= Math.ceil(a.peers.length * 0.6) ? 'tone-bad' : ''}`}>
                  {users}/{a.peers.length}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const CAUSES = [
  { key: 'ownChoice', label: 'Your choice', cls: 'ov-own', hint: 'Heal bigger than the gap when you committed' },
  { key: 'othersFilled', label: 'Others healed first', cls: 'ov-others', hint: 'The gap was there, but other heals filled it before yours landed' },
  { key: 'chainHealBounces', label: 'Chain Heal bounces', cls: 'ov-bounce', hint: 'Jumps you don’t aim' },
  { key: 'hotTicks', label: 'HoT ticks', cls: 'ov-hot', hint: 'Ticks on a full target' },
  { key: 'procHeals', label: 'Procs', cls: 'ov-proc', hint: 'Prayer of Mending, Earth Shield' },
] as const;

/** Overheal as a share of everything you put out, split by cause; peers below. */
export function OverhealBars({ analysis: a }: { analysis: HealerAnalysis }) {
  const rows = [{ name: `${a.you.name} (you)`, m: a.you }, ...a.peers.map((p) => ({ name: p.name, m: p as HealerMetrics }))];
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Overheal by cause</h2>
          <p className="sub">
            Bar length is overheal as a share of everything you healed; the colours say why. Only <strong>your choice</strong> is on you: the heal was already bigger than
            the missing health when you started casting (or when an instant landed).
          </p>
        </div>
        <div className="legend">
          {CAUSES.map((c) => (
            <span key={c.key} title={c.hint}>
              <i className={`sw ${c.cls}`} /> {c.label}
            </span>
          ))}
        </div>
      </div>
      <div className="ov-rows">
        {rows.map(({ name, m }) => (
          <div className="ov-row" key={name}>
            <span className="small">{name}</span>
            <div className="ov-track">
              {CAUSES.map((c) => {
                const w = m.overheal[c.key] * m.overhealPct * 100;
                return w > 0.2 ? <div key={c.key} className={`ov-seg ${c.cls}`} style={{ width: `${w}%` }} title={`${c.label}: ${pct(m.overheal[c.key] * m.overhealPct)} of all healing`} /> : null;
              })}
            </div>
            <span className="mono small">{pct(m.overhealPct)}</span>
          </div>
        ))}
      </div>
      <div className="muted small">
        Your direct casts: {a.you.castsClean} landed with no overheal, {a.you.castsWithOverheal} with some.
      </div>
    </section>
  );
}
