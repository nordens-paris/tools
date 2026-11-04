import { useMemo } from 'react';
import { biggestAbilityGap, gapNoise, playByAbility, simScale, type SimShare } from '../../../shared/dpsGap.ts';
import type { SimPlayerResult } from '../../../shared/types.ts';
import { abilityIcon, fmt, fmtSigned } from '../format.ts';
import { useGroup } from '../group.ts';

type Group = ReturnType<typeof useGroup>;

/**
 * The Play tile split by ability, for you against the group. The ability that costs you most is
 * only picked out when the Play gap itself is outside the noise.
 */
export function usePlayByAbility(execution: SimPlayerResult[]) {
  return useMemo(() => {
    const you = execution.find((e) => !e.rank);
    if (!you) return undefined;
    const k = simScale(execution);
    const table = playByAbility(execution, you, k);
    if (!table) return undefined;
    const half = gapNoise(execution, you).parts.play.half;
    const real = table.total.gap > half;
    return { you, k, table, half, real, biggest: real ? biggestAbilityGap(table, you) : undefined };
  }, [execution]);
}

/** One sentence on the ability that costs you most, worded from why (casts, per cast or the group). */
export function abilityFindingText(hit: NonNullable<ReturnType<typeof biggestAbilityGap>>, G: Group): { title: string; detail: string } {
  const { row, reason } = hit;
  const unit = row.byHits ? 'hits' : 'casts';
  const title = `${row.name}: ${fmt(row.gap)} DPS behind ${G.noun}`;
  if (reason === 'casts' && row.perMinute !== undefined && row.simPerMinute !== undefined) {
    // Time spent on another ability instead shows up as a gain in that ability's row.
    const instead = ' If you spent that time on something else, its row shows what that brought back.';
    if (!row.perMinute) {
      return { title, detail: `The sim of your setup casts ${row.name} ${fmt(row.simPerMinute, 1)} times per minute and you didn't cast it: about ${fmt(-row.castsPart!)} DPS.${instead}` };
    }
    return {
      title,
      detail: `You ${row.byHits ? 'landed' : 'cast'} ${row.name} ${fmt(row.simPerMinute - row.perMinute, 1)} fewer times per minute than your setup allows in the sim (${fmt(row.perMinute, 1)} vs ${fmt(row.simPerMinute, 1)}); that's about ${fmt(-row.castsPart!)} DPS.${instead}`,
    };
  }
  if (reason === 'perCast' && row.perCast !== undefined && row.simPerCast !== undefined) {
    return {
      title,
      detail: `Your ${row.name} did ${fmt(row.perCast)} per ${unit === 'hits' ? 'hit' : 'cast'} against ${fmt(row.simPerCast)} in the sim, luck removed: about ${fmt(-row.perCastPart!)} DPS. Missing buffs or debuffs, clipped DoTs and hits on adds lower it.`,
    };
  }
  const pace = row.groupPerMinute !== undefined && row.perMinute !== undefined ? ` They ${row.byHits ? 'landed' : 'cast'} it ${fmt(row.groupPerMinute, 1)} times per minute (median), you ${fmt(row.perMinute, 1)}.` : '';
  return { title, detail: `${G.Noun} got more out of ${row.name} than their sims expect, by about ${fmt(row.gap)} DPS more than you did.${pace}` };
}

const pct = (v?: number) => (v === undefined ? '–' : `${fmt(v * 100)}%`);

/** The shared axis of one column of share plots: at least 90–110%, at most 70–130%, in 5% steps. */
function axisOf(values: (number | undefined)[]): [number, number] {
  const ok = values.filter((v): v is number => v !== undefined);
  const lo = Math.max(0.7, Math.floor(Math.min(0.9, ...ok) * 20) / 20);
  const hi = Math.min(1.3, Math.ceil(Math.max(1.1, ...ok) * 20) / 20);
  return [lo, hi];
}

/** Where a share sits on an axis, clamped to its ends, as a CSS left. */
const at = (v: number, [lo, hi]: [number, number]) => `${((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100}%`;

/** One share of the sim: the 100% line, the group's range as a band, their average (ring) and you (dot). */
function SharePlot({ share, axis, title }: { share: SimShare; axis: [number, number]; title: string }) {
  return (
    <div className="pba-plot" title={title}>
      <span className="pba-track" />
      <span className="pba-hundred" style={{ left: at(1, axis) }} />
      {share.range && <span className="pba-band" style={{ left: at(share.range[0], axis), width: `calc(${at(share.range[1], axis)} - ${at(share.range[0], axis)})` }} />}
      {share.group !== undefined && <span className="exec-ring" style={{ left: at(share.group, axis) }} />}
      {share.you !== undefined && <span className="pba-dot" style={{ left: at(share.you, axis) }} />}
    </div>
  );
}

function ShareCell({ share, axis, title, G, empty }: { share: SimShare; axis: [number, number]; title: string; G: Group; empty?: string }) {
  return (
    <div className="pba-cell">
      <SharePlot share={share} axis={axis} title={title} />
      <div className="pba-val" title={title}>
        <span className="strong">{empty ?? pct(share.you)}</span>
        <span className="muted small">
          {G.short} {pct(share.group)}
        </span>
      </div>
    </div>
  );
}

/** The axis labels above a column of share plots. */
function AxisHead({ label, axis }: { label: string; axis: [number, number] }) {
  return (
    <div className="pba-cell">
      <div className="exec-axis">
        {[axis[0], 1, axis[1]].map((v) => (
          <span key={v} className={v === 1 ? 'strong' : ''} style={{ left: at(v, axis) }}>
            {fmt(v * 100)}%
          </span>
        ))}
      </div>
      <span className="eyebrow">{label}</span>
    </div>
  );
}

const range = (r?: [number, number]) => (r ? ` (${fmt(r[0] * 100)}–${fmt(r[1] * 100)}%)` : '');

/**
 * Play by ability: where the Play tile comes from. Per ability, how often you cast it and how hard
 * each cast hit, as shares of the sim of your setup, against the group's range and average on their
 * own sims, and what the difference is worth in DPS (adding up to the Play tile).
 */
export function PlayByAbilityPanel({ execution }: { execution: SimPlayerResult[] }) {
  const G = useGroup();
  const data = usePlayByAbility(execution);
  if (!data) return null;
  const { table, biggest, half, you, k } = data;
  const finding = biggest && abilityFindingText(biggest, G);
  const { overall } = table;
  // Coloured from 1% of your DPS (the total: outside the tile's ±); red where they got more.
  const tone = (gap: number, matters: boolean) => (!matters || Math.abs(gap) < 0.5 ? 'muted' : gap > 0 ? 'tone-bad' : 'tone-good');
  const rowTone = (gap: number) => tone(gap, Math.abs(gap) >= 0.01 * you.actualDps);
  const castsAxis = axisOf(table.rows.flatMap((r) => [r.castsPct, ...(r.groupCastsRange ?? [])]));
  const perCastAxis = axisOf(table.rows.flatMap((r) => [r.perCastPct, ...(r.groupPerCastRange ?? [])]));
  const shownOther = table.other.names.slice(0, 4);
  const totalTone = tone(table.total.gap, Math.abs(table.total.gap) > half);
  const perMin = (v?: number) => (v === undefined ? '–' : fmt(v, 1));

  return (
    <details className="panel setup-notes play-abilities">
      <summary>
        <h2>Play by ability</h2>
        <span className="muted small">
          Where the Play tile’s {fmtSigned(table.total.gap)} DPS comes from{finding ? ` · biggest: ${biggest!.row.name}` : ''}
        </span>
      </summary>
      <div className="pba">
        <p className="sub">
          How often you cast each ability and how hard each cast hit, against the sim of your own setup (100% = as the sim, luck removed), next to {G.noun} against theirs.
          {overall.casts.group !== undefined && overall.perCast.group !== undefined && (
            <>
              {' '}
              {G.Noun} average {pct(overall.casts.group)} of their sims’ casts and {pct(overall.perCast.group)} of the damage per cast: together the {fmt(k * 100)}% the tiles
              scale the sims to.
            </>
          )}
        </p>
        <div className="luck-grid three">
          <div className="luck-stat">
            <span className="eyebrow">Play, {G.short} vs you</span>
            <span className={`v ${totalTone}`}>
              {fmtSigned(table.total.gap)} <span className="noise-pm">±{fmt(half)}</span>
            </span>
            <span className="muted small">
              avg DPS · {Math.abs(table.total.gap) <= half ? 'within the noise' : table.total.gap > 0 ? 'they got more out of their setup' : 'you got more out of your setup'}
            </span>
          </div>
          <div className="luck-stat">
            <span className="eyebrow">Casts vs sim</span>
            <span className="v">{pct(overall.casts.you)}</span>
            <span className="muted small">
              {G.short} {pct(overall.casts.group)}
              {range(overall.casts.range)}
            </span>
          </div>
          <div className="luck-stat">
            <span className="eyebrow">Damage per cast vs sim</span>
            <span className="v">{pct(overall.perCast.you)}</span>
            <span className="muted small">
              {G.short} {pct(overall.perCast.group)}
              {range(overall.perCast.range)}
            </span>
          </div>
        </div>
        {finding && <div className="verdict unlucky">{`${finding.title}. ${finding.detail}`}</div>}

        <div className="pba-rows">
          <div className="pba-row pba-head">
            <span className="eyebrow">Ability</span>
            <AxisHead label="Casts vs sim" axis={castsAxis} />
            <AxisHead label="Damage per cast vs sim" axis={perCastAxis} />
            <span className="eyebrow pba-diffhead">{G.short} vs you</span>
          </div>
          {table.rows.map((r) => {
            const unit = r.byHits ? 'hits' : 'casts';
            const castsTitle = `${perMin(r.perMinute)} ${unit} per minute; the sim of your setup ${perMin(r.simPerMinute)}${r.groupPerMinute !== undefined ? `; ${G.short} median ${perMin(r.groupPerMinute)}` : ''}. ${G.short} range${range(r.groupCastsRange) || ' –'}.`;
            const perCastTitle = `${r.perCast !== undefined ? fmt(r.perCast) : '–'} per ${r.byHits ? 'hit' : 'cast'} with luck removed; the sim ${r.simPerCast !== undefined ? fmt(r.simPerCast) : '–'}. ${G.short} range${range(r.groupPerCastRange) || ' –'}.`;
            return (
              <div key={r.name} className="pba-row">
                <span className="pba-name">
                  {r.icon ? <img src={abilityIcon(r.icon)} alt="" /> : <span className="pba-noicon" />}
                  <span className="strong">{r.name}</span>
                  {r.byHits && <span className="muted small">hits</span>}
                </span>
                <ShareCell
                  share={{ you: r.castsPct, group: r.groupCastsPct, range: r.groupCastsRange }}
                  axis={castsAxis}
                  title={castsTitle}
                  G={G}
                  empty={r.castsPct === undefined && r.perMinute ? 'not simmed' : undefined}
                />
                <ShareCell share={{ you: r.perCastPct, group: r.groupPerCastPct, range: r.groupPerCastRange }} axis={perCastAxis} title={perCastTitle} G={G} />
                <span className={`pba-diff ${rowTone(r.gap)}`}>{fmtSigned(r.gap)}</span>
              </div>
            );
          })}
          <div className="pba-row pba-other">
            <span className="pba-name">
              <span className="pba-noicon" />
              <span>
                Other
                {shownOther.length > 0 && (
                  <span className="muted small">
                    {' '}
                    · {shownOther.join(', ')}
                    {table.other.names.length > shownOther.length ? ', …' : ''}
                  </span>
                )}
              </span>
            </span>
            <span className="pba-skip" />
            <span className="pba-skip" />
            <span className={`pba-diff ${rowTone(table.other.gap)}`}>{fmtSigned(table.other.gap)}</span>
          </div>
          <div className="pba-row pba-total">
            <span className="strong">Play (the tile)</span>
            <span className="pba-skip" />
            <span className="pba-skip" />
            <span className={`pba-diff strong ${totalTone}`}>{fmtSigned(table.total.gap)}</span>
          </div>
        </div>

        <div className="legend">
          <span>
            <span className="exec-key pba-key-dot" /> You
          </span>
          <span>
            <span className="exec-key ring" /> {G.short} average
          </span>
          <span>
            <span className="pba-key-band" /> {G.short} lowest to highest
          </span>
          <span className="pba-legend-tones">
            <b className="tone-bad">+</b> {G.short} got more DPS out of it, <b className="tone-good">−</b> you did (grey: under 1% of your DPS)
          </span>
        </div>
        <p className="muted small">
          {G.short} vs you: the DPS {G.noun} got out of the ability beyond their sims, on average, minus yours, with the sims scaled like the tiles; the rows add up to the Play
          tile. Luck is taken out first: crits, misses and resists, and each ability’s share of procs and knock-on effects (Improved Shadow Bolt, Flurry). Lower damage per cast
          can be play (cooldowns, trinkets and potions used late or not lined up with your casts, casts on adds, lower ranks, clipped DoTs), but also buffs and debuffs the sim
          doesn’t copy exactly and the spread of damage rolls: the band shows what is normal among {G.noun}. Hover a plot for the numbers behind it. “Hits”: white swings, procs
          and pets have no casts, so hits are counted. Other is the smaller abilities and damage the sim names differently.
        </p>
      </div>
    </details>
  );
}
