import { useEffect, useState } from 'react';

import { getReport, type ReportInfo } from '../api.ts';
import { fmtTime } from '../format.ts';

// One lookup per report per visit; switching bosses doesn't fetch the fight list again.
const reports = new Map<string, Promise<ReportInfo>>();

/** Switches the analysis to another boss in the same report, for the same player. */
export function BossPicker({ report, fight, source, loading, onChange }: { report: string; fight: number; source: number; loading: boolean; onChange: (fight: number) => void }) {
  const [info, setInfo] = useState<ReportInfo>();

  useEffect(() => {
    let live = true;
    if (!reports.has(report)) reports.set(report, getReport(report).catch((err) => { reports.delete(report); throw err; }));
    reports.get(report)!.then((r) => live && setInfo(r)).catch(() => undefined);
    return () => { live = false; };
  }, [report]);

  const mine = info?.players.find((p) => p.id === source)?.fights ?? [];
  const fights = info?.fights.filter((f) => mine.includes(f.id) || f.id === fight) ?? [];
  // Wipes are listed after the kills, so a long progress night doesn't bury them.
  const kills = fights.filter((f) => f.kill);
  const wipes = fights.filter((f) => !f.kill);
  if (fights.length < 2) return null;

  const option = (f: ReportInfo['fights'][number]) => (
    <option key={f.id} value={f.id}>
      {f.name} · {fmtTime(f.durationSec)}
    </option>
  );
  return (
    <label className="boss-picker">
      <span className="eyebrow">Boss</span>
      <select value={fight} disabled={loading} onChange={(e) => onChange(Number(e.target.value))} aria-label="Boss fight">
        <optgroup label="Kills">{kills.map(option)}</optgroup>
        {wipes.length > 0 && <optgroup label="Wipes">{wipes.map(option)}</optgroup>}
      </select>
    </label>
  );
}
