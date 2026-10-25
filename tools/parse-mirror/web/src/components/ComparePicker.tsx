import type { AnalysisResult } from '../../../shared/types.ts';

/** Who the fight is compared with: the world's best, or players with your gear who did a bit better. */
export function ComparePicker({ analysis, loading, onChange }: { analysis: AnalysisResult; loading: boolean; onChange: (peers: boolean) => void }) {
  const peers = analysis.comparison.mode === 'peers';
  return (
    <section className="compare-picker">
      <span className="eyebrow">Compare with</span>
      <div className="segmented" role="group" aria-label="Compare with">
        <button aria-pressed={!peers} disabled={loading} onClick={() => peers && onChange(false)}>
          Top 10
        </button>
        <button aria-pressed={peers} disabled={loading} onClick={() => !peers && onChange(true)}>
          Same gear, a step ahead
        </button>
      </div>
      <span className="muted small">
        {peers ? analysis.comparison.description : 'The 10 best parses of your spec on this boss. Switch to see players with your item level who parsed a bit better: easier to copy, and less about luck.'}
      </span>
    </section>
  );
}
