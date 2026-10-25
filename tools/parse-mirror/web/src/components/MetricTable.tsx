import type { MetricRow, PlayerFight } from '../../../shared/types.ts';
import { abilityIcon, fmt } from '../format.ts';
import { useGroup } from '../group.ts';

interface Props {
  title: string;
  subtitle?: string;
  rows: MetricRow[];
  top: PlayerFight[];
}

/** You vs the top 10: grey bar = top 10 range, line = median, dot = you. */
export function MetricTable({ title, subtitle, rows, top }: Props) {
  const G = useGroup();
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
            <i className="sw" style={{ background: 'var(--range)' }} /> {G.short} range
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
          <div>Ability</div>
          <div className="num">You</div>
          <div className="num">Median</div>
          <div>{G.short}</div>
        </div>
        {rows.map((r) => (
          <MetricRowView key={r.key} row={r} top={top} />
        ))}
      </div>
    </section>
  );
}

function MetricRowView({ row, top }: { row: MetricRow; top: PlayerFight[] }) {
  const digits = row.digits ?? (row.unit === '%' || row.unit === 's' ? 0 : 1);
  const scaleMax = Math.max(row.max, row.you, 1) * 1.08;
  const pos = (v: number) => `${(v / scaleMax) * 100}%`;
  const diff = row.you - row.median;
  const tone =
    row.higherIsBetter === null || Math.abs(diff) < Math.max(0.05 * row.median, 0.2)
      ? 'neutral'
      : diff > 0 === row.higherIsBetter
        ? 'good'
        : 'bad';
  const tooltip = top.map((p, i) => `#${p.rank ?? i + 1} ${p.name}: ${row.top[i] === null ? '–' : fmt(row.top[i]!, digits)}`).join('\n');

  return (
    <div className="metric-row">
      <div className="metric-label">
        {row.icon && <img src={abilityIcon(row.icon)} alt="" />}
        <span>{row.label.replace(/ cast efficiency$/, '')}</span>
      </div>
      <div className={`num strong tone-${tone}`}>
        {fmt(row.you, digits)}
        {row.unit && <span className="unit">{row.unit}</span>}
      </div>
      <div className="num">
        {fmt(row.median, digits)}
        {row.unit && <span className="unit">{row.unit}</span>}
      </div>
      <div className="rangebar" title={tooltip}>
        <div className="range" style={{ left: pos(row.min), width: `calc(${pos(row.max)} - ${pos(row.min)})` }} />
        <div className="median-tick" style={{ left: pos(row.median) }} />
        <div className={`you-dot tone-${tone}`} style={{ left: pos(row.you) }} />
      </div>
    </div>
  );
}
