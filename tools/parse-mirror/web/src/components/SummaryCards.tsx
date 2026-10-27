import type { AnalysisResult, SimResult } from '../../../shared/types.ts';
import { fmt, fmtSigned } from '../format.ts';
import { Hint } from './Hint.tsx';
import { useGroup } from '../group.ts';

export function SummaryCards({ analysis, sim }: { analysis: AnalysisResult; sim?: SimResult }) {
  const G = useGroup();
  const get = (key: string) => analysis.metrics.summary.find((m) => m.key === key)!;
  const dps = get('dps');
  const noPi = analysis.metrics.summary.find((m) => m.key === 'dpsNoPi');
  const dur = get('duration');
  const ilvl = get('ilvl');
  const active = get('active');
  const you = sim?.execution.find((e) => !e.rank);
  const pctOfTop = dps.median ? (dps.you / dps.median) * 100 : 0;

  return (
    <section className="kpis">
      <Kpi label="DPS" value={fmt(dps.you)} delta={dps.you - dps.median} good={dps.you >= dps.median} sub={`${G.short} median ${fmt(dps.median)}${noPi && Math.round(noPi.median) !== Math.round(dps.median) ? ` · ${fmt(noPi.median)} without Power Infusion` : ''}`} bar={pctOfTop} />
      <Kpi label="Kill time" value={fmt(dur.you)} unit="s" delta={dur.you - dur.median} deltaUnit="s" good={dur.you <= dur.median} sub={`${G.short} median ${fmt(dur.median)} s`} />
      <Kpi label="Item level" value={fmt(ilvl.you, 1)} delta={ilvl.you - ilvl.median} digits={1} good={ilvl.you >= ilvl.median} sub={`${G.short} median ${fmt(ilvl.median, 1)}`} />
      <Kpi label={analysis.spec.activityLabel} value={fmt(active.you)} unit="%" delta={active.you - active.median} deltaUnit=" pts" good={active.you >= active.median - 1} sub={`${G.short} median ${fmt(active.median)}%`} bar={active.you} />
      <Kpi
        label={`Execution vs ${G.noun}`}
        hint={`Your DPS as a share of what the sim says your own gear, buffs and kill time can do, scaled so the median of ${G.noun} is 100%. Above 100% means you got more out of your setup than they did.`}
        value={you ? fmt(you.relativePct) : '…'}
        unit={you ? '%' : undefined}
        delta={you ? you.relativePct - 100 : undefined}
        deltaUnit=" pts"
        good={you ? you.relativePct >= 98 : undefined}
        sub={you ? `${fmt(you.luckAdjustedPct)}% with luck removed` : 'Simming…'}
        bar={you?.relativePct}
      />
    </section>
  );
}

export function Kpi(props: {
  label: string;
  value: string;
  unit?: string;
  sub: string;
  delta?: number;
  deltaUnit?: string;
  digits?: number;
  good?: boolean;
  bar?: number;
  hint?: string;
}) {
  const tone = props.delta === undefined || Math.abs(props.delta) < 0.05 ? 'neutral' : props.good ? 'good' : 'bad';
  return (
    <div className="kpi">
      <div className="eyebrow">
        {props.label}
        {props.hint && <Hint text={props.hint} />}
      </div>
      <div className="kpi-value">
        {props.value}
        {props.unit && <span className="unit">{props.unit}</span>}
        {props.delta !== undefined && (
          <span className={`delta ${tone}`}>
            {fmtSigned(props.delta, props.digits ?? 0)}
            {props.deltaUnit ?? ''}
          </span>
        )}
      </div>
      <div className="kpi-sub">{props.sub}</div>
      {props.bar !== undefined && (
        <div className="kpi-bar">
          <div style={{ width: `${Math.max(0, Math.min(100, props.bar))}%` }} />
        </div>
      )}
    </div>
  );
}
