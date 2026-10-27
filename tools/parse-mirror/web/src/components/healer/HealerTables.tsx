import type { HealerAnalysis, HealerDeath, HealerRow } from '../../../../shared/types.ts';
import { specIcon } from '../../brand.ts';
import { abilityIcon, fmt, fmtTime, wclReportUrl } from '../../format.ts';
import { Hint } from '../Hint.tsx';

export const fmtRow = (format: HealerRow['format'], v: number | null) =>
  v === null
    ? '–'
    : format === 'pct'
      ? `${Math.round(v * 100)}%`
      : format === 'sec'
        ? `${v.toFixed(1)} s`
        : format === 'dec'
          ? v.toFixed(1)
          : fmt(v);

export const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Class-spec icon for "Priest-Holy" style icons. */
export const iconOf = (icon: string) => {
  const [cls, spec] = icon.split('-');
  return spec ? specIcon(cls, spec) : `/icons/class-${cls.toLowerCase()}.jpg`;
};

/** good / bad / neutral for a judged row; context rows are always neutral. */
export function rowTone(r: HealerRow) {
  if (r.higherIsBetter === undefined || r.you === null || r.median === null) return 'neutral';
  const diff = r.you - r.median;
  const scale = Math.max(Math.abs(r.median) * 0.1, r.format === 'pct' ? 0.03 : r.format === 'sec' ? 0.5 : r.format === 'int' ? 0.5 : 0.1);
  if (Math.abs(diff) < scale) return 'neutral';
  return diff > 0 === r.higherIsBetter ? 'good' : 'bad';
}

/** You vs the peers: grey bar = peer range, line = median, dot = you. */
export function RowTable({ title, subtitle, rows, peers }: { title: string; subtitle?: string; rows: HealerRow[]; peers: HealerAnalysis['peers'] }) {
  if (!rows.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="sub">{subtitle}</p>}
        </div>
        <div className="legend">
          <span>
            <i className="sw" style={{ background: 'var(--range)' }} /> Peer range
          </span>
          <span>
            <i className="sw" style={{ background: 'var(--fg-2)', width: 2 }} /> Median
          </span>
          <span>
            <i className="sw" style={{ background: 'var(--accent)', borderRadius: '50%' }} /> You
          </span>
        </div>
      </div>
      <div className="metric-table">
        <div className="metric-row metric-head">
          <div />
          <div className="num">You</div>
          <div className="num">Peers</div>
          <div>Range</div>
        </div>
        {rows.map((r) => {
          const vals = r.peers.filter((v): v is number => v !== null);
          const all = [...vals, r.you ?? 0];
          const max = Math.max(...all, r.format === 'pct' ? 0.05 : 1) * 1.08;
          const pos = (v: number) => `${(Math.max(0, v) / max) * 100}%`;
          const tone = rowTone(r);
          const tip = peers.map((p, i) => `${p.name}: ${fmtRow(r.format, r.peers[i] ?? null)}`).join('\n');
          return (
            <div className="metric-row" key={r.key}>
              <div className="metric-label">
                <span>
                  {r.label}
                  {r.hint && <Hint text={r.hint} />}
                </span>
              </div>
              <div className={`num strong tone-${tone}`}>{fmtRow(r.format, r.you)}</div>
              <div className="num">{fmtRow(r.format, r.median)}</div>
              <div className="rangebar" title={tip}>
                {vals.length > 0 && <div className="range" style={{ left: pos(Math.min(...vals)), width: `calc(${pos(Math.max(...vals))} - ${pos(Math.min(...vals))})` }} />}
                {r.median !== null && <div className="median-tick" style={{ left: pos(r.median) }} />}
                {r.you !== null && <div className={`you-dot tone-${tone}`} style={{ left: pos(r.you) }} />}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Share of healing, healing per mana and overheal per spell, you vs the peer medians. */
export function SpellTable({ analysis: a }: { analysis: HealerAnalysis }) {
  const ranks = a.you.spells.filter((s) => s.ranks);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Spells</h2>
          <p className="sub">
            What your healing came from, next to the peers (medians; healing per mana only over peers who cast the spell). Bigger gaps in healing per mana usually
            mean the spell landed on targets that didn't need all of it.
          </p>
        </div>
      </div>
      <div className="table-scroll">
        <table className="t spell-table">
          <thead>
            <tr>
              <th>Spell</th>
              <th className="num">Casts</th>
              <th>Share of healing</th>
              <th className="num">Healing per mana</th>
              <th className="num">Overheal</th>
            </tr>
          </thead>
          <tbody>
            {a.spells.map((s) => {
              const hpmTone = s.you.healPerMana !== null && s.peers.healPerMana !== null ? (s.you.healPerMana < s.peers.healPerMana * 0.85 ? 'bad' : s.you.healPerMana > s.peers.healPerMana * 1.15 ? 'good' : '') : '';
              return (
                <tr key={s.name}>
                  <td>
                    <span className="spell-name">
                      {s.icon && <img src={abilityIcon(s.icon)} alt="" />}
                      {s.name}
                    </span>
                  </td>
                  <td className="num mono">{s.you.casts || '–'}</td>
                  <td>
                    <div className="share-bars" title={`You ${pct(s.you.share)} · peers ${pct(s.peers.share)} (${s.peers.users} of ${a.peers.length} cast it)`}>
                      <div className="share-bar you" style={{ width: `${s.you.share * 100}%` }} />
                      <div className="share-bar peer" style={{ width: `${s.peers.share * 100}%` }} />
                      <span className="mono small">
                        {pct(s.you.share)} <span className="muted">/ {pct(s.peers.share)}</span>
                      </span>
                    </div>
                  </td>
                  <td className="num mono">
                    <span className={hpmTone ? `tone-${hpmTone}` : ''}>{s.you.healPerMana === null ? '–' : s.you.healPerMana.toFixed(1)}</span>
                    <span className="muted"> / {s.peers.healPerMana === null ? '–' : s.peers.healPerMana.toFixed(1)}</span>
                  </td>
                  <td className="num mono">
                    {s.you.share ? pct(s.you.overheal) : '–'}
                    <span className="muted"> / {s.peers.users ? pct(s.peers.overheal) : '–'}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="muted small">
        Each cell: you / peers.
        {ranks.length > 0 && ` Ranks used: ${ranks.map((s) => `${s.name} (${s.ranks!.length})`).join(', ')}.`}
      </div>
    </section>
  );
}

/** Who you're compared with, and the raids they came from. */
export function PeerTable({ analysis: a }: { analysis: HealerAnalysis }) {
  const you = a.you;
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
              <th>Healer</th>
              <th>Raid</th>
              <th className="num">Healers</th>
              <th className="num">
                Damage per healer
                <Hint text="The raid's damage taken per second, divided by its healers: how much there was to heal." />
              </th>
              <th className="num">Deaths</th>
              <th className="num">On tanks</th>
              <th className="num">
                Parses
                <Hint text="Median healing parse over their kills this tier, and how many kills. Raids with many healers parse low for everyone, so 50+ already means consistent." />
              </th>
              <th className="num">HPS</th>
            </tr>
          </thead>
          <tbody>
            <tr className="you">
              <td>
                <span className="spell-name">
                  <img src={iconOf(you.icon)} alt="" />
                  <strong>{you.name}</strong> <span className="muted small">you</span>
                </span>
              </td>
              <td className="muted">{fmtTime(a.durationSec)}</td>
              <td className="num mono">{a.raid.healers}</td>
              <td className="num mono">{fmt(a.raid.dtps / Math.max(1, a.raid.healers))}</td>
              <td className="num mono">{a.deaths.length}</td>
              <td className="num mono">{pct(you.tankShare)}</td>
              <td className="num mono">–</td>
              <td className="num mono">{fmt(you.hps)}</td>
            </tr>
            {a.peers.map((p) => (
              <tr key={`${p.peer.report}:${p.name}`}>
                <td>
                  <a className="spell-name" href={`${wclReportUrl(p.peer.report)}?fight=${p.peer.fight}&source=${p.source}&type=healing`} target="_blank" rel="noreferrer">
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
                <td className="num mono">{p.peer.raid.healers}</td>
                <td className="num mono">{fmt(p.peer.raid.dtpsPerHealer)}</td>
                <td className="num mono">{p.peer.raid.deaths}</td>
                <td className="num mono">{pct(p.tankShare)}</td>
                <td className="num mono">{p.peer.consistency ? `${fmt(p.peer.consistency.median)} · ${p.peer.consistency.kills}` : '–'}</td>
                <td className="num mono">{fmt(p.hps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted small">
        Raids come from the boss's execution (cleanest kills) and speed (fastest kills) rankings. {a.group.raidsChecked} raids checked.
      </div>
    </section>
  );
}

const KIND: Record<HealerDeath['kind'], { label: string; pill: string; text: string }> = {
  burst: { label: 'Burst', pill: 'bad', text: 'From 60%+ to dead in one hit: no time to heal.' },
  fast: { label: 'Fast', pill: 'warn', text: 'Under 2 s below 50%: very little time to react.' },
  window: { label: 'Time to save', pill: 'acc', text: 'Two seconds or more below 50% before dying.' },
};

/** HP over the last seconds before a death. */
function HpSpark({ hp }: { hp: [number, number][] }) {
  if (hp.length < 2) return null;
  const w = 140;
  const h = 34;
  const t0 = Math.min(...hp.map((p) => p[0]));
  const x = (t: number) => (t0 ? ((t - t0) / -t0) * (w - 6) + 3 : w / 2);
  const y = (v: number) => h - 3 - (v / 100) * (h - 6);
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="HP before death">
      <line x1="0" x2={w} y1={y(50)} y2={y(50)} className="spark-mid" />
      <polyline points={hp.map(([t, v]) => `${x(t)},${y(v)}`).join(' ')} className="spark-line" />
      {hp.map(([t, v], i) => (
        <circle key={i} cx={x(t)} cy={y(v)} r={2.5} className="hp-dot">
          <title>{`${t.toFixed(1)} s: ${v}%`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function DeathList({ analysis: a }: { analysis: HealerAnalysis }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Deaths</h2>
          <p className="sub">
            Every death on this kill: how fast it happened, the damage in the last 5 seconds, and what each healer cast while it happened. Only deaths with time to save
            someone say anything about healing.
          </p>
        </div>
      </div>
      {!a.deaths.length && <div className="muted">Nobody died on this kill.</div>}
      <div className="deaths">
        {a.deaths.map((d, i) => (
          <div className="death" key={i}>
            <div className="death-head">
              <img src={iconOf(d.icon)} alt="" />
              <strong>{d.player}</strong>
              <span className="muted mono small">{fmtTime(d.atSec)}</span>
              <span className={`pill ${KIND[d.kind].pill}`} title={KIND[d.kind].text}>
                {KIND[d.kind].label}
                {d.secBelow50 !== undefined && d.kind !== 'burst' ? ` · ${d.secBelow50.toFixed(1)} s under 50%` : ''}
              </span>
              <HpSpark hp={d.hp} />
            </div>
            <div className="small">
              Killed by <strong>{d.killedBy}</strong>
              {d.periodicSec && <span className="muted"> (hits on a timer, every {d.periodicSec} s)</span>}
              <span className="muted"> · last 5 s: {d.damage5s.map((x) => `${x.name} ${fmt(x.amount)}`).join(', ')}</span>
            </div>
            <ul className="death-healers">
              {d.healers.map((h) => (
                <li key={h.name} className={h.name === a.you.name ? 'you' : ''}>
                  <span className="strong">{h.name}</span> <span className="muted">{h.casts.length ? h.casts.join(' · ') : 'no casts'}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
