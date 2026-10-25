import type { AnalysisResult, SimResult } from '../../../shared/types.ts';
import { fmt, fmtSigned } from '../format.ts';
import { useGroup } from '../group.ts';

interface Item {
  title: string;
  detail: string;
  /** DPS the sim puts on it, when it can. */
  dps?: number;
  tab: string;
}

const TAB_OF_AREA: Record<string, string> = { Rotation: 'Rotation', Cooldowns: 'Cooldowns', Consumes: 'Consumes', Gear: 'Gear', Talents: 'Gear', Buffs: 'Sim', Fight: 'Overview' };

/**
 * The three things most worth changing, so nobody has to read every panel: the consumes what-if
 * when the sim measures a real gain, then the biggest findings.
 */
export function FixFirst({ analysis, sim, onTab }: { analysis: AnalysisResult; sim?: SimResult; onTab: (tab: string) => void }) {
  const G = useGroup();
  const base = sim?.scenarios[0];
  const items: Item[] = [];
  for (const s of sim?.scenarios ?? []) {
    // Only consumes are a quick fix; the top player's gear and raid buffs aren't.
    if (s.key !== 'consumes' || !base || s.deltaVsBaseline / base.dps < 0.01) continue;
    items.push({ title: `Use the ${G.short.toLowerCase()} consumes`, detail: s.description, dps: s.deltaVsBaseline, tab: 'Consumes' });
  }
  for (const sev of ['high', 'medium'] as const) {
    for (const f of analysis.findings.filter((x) => x.severity === sev)) {
      // Consume findings are already covered by the sim's number above.
      if (items.some((i) => i.dps) && f.area === 'Consumes') continue;
      items.push({ title: f.title, detail: f.detail, tab: TAB_OF_AREA[f.area] ?? 'Overview' });
    }
  }
  const shown = items.slice(0, 3);
  if (!shown.length) return null;

  return (
    <section className="panel fix-first">
      <div className="panel-head">
        <div>
          <h2>Fix first</h2>
          <p className="sub">The three changes most likely to raise your DPS{sim ? '' : ' (sim numbers appear when the sims finish)'}.</p>
        </div>
      </div>
      <ol className="fix-list">
        {shown.map((item, i) => (
          <li key={item.title}>
            <span className="fix-n">{i + 1}</span>
            <div>
              <div className="strong">
                {item.title}
                {item.dps !== undefined && base && (
                  <span className="tone-good mono small">
                    {' '}
                    {fmtSigned(item.dps)} DPS ({fmtSigned((item.dps / base.dps) * 100, 1)}%)
                  </span>
                )}
              </div>
              <div className="muted small">{item.detail}</div>
            </div>
            <button className="ghost small" onClick={() => onTab(item.tab)}>
              {item.tab} →
            </button>
          </li>
        ))}
      </ol>
      {sim && base && <div className="muted small">Your setup sims at {fmt(base.dps)} DPS on your kill time.</div>}
    </section>
  );
}
