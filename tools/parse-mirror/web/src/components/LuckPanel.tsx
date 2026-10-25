import type { SimPlayerResult } from '../../../shared/types.ts';
import { fmt, fmtSigned } from '../format.ts';
import { Hint } from './Hint.tsx';
import { useGroup } from '../group.ts';

/** Did RNG help or hurt this parse? Actual crits/misses vs what the sim expects for the setup. */
export function LuckPanel({ you, top, knockOn }: { you: SimPlayerResult; top: SimPlayerResult[]; knockOn: string }) {
  const G = useGroup();
  const l = you.luck;
  const topLuck = top.length ? top.reduce((s, t) => s + t.luck.luckPct, 0) / top.length : 0;
  const z = l.critZ;
  // Spells can be partially resisted, and full resists count as misses.
  const spells = l.resistPct !== undefined;
  const showResists = l.abilities.some((a) => a.resistPct !== undefined);
  const verdict =
    Math.abs(l.luckPct) < 3
      ? { cls: '', text: `Normal luck: RNG changed your DPS by ${fmtSigned(l.luckPct, 1)}%, well within normal variation. The difference to ${G.noun} is about setup and play.` }
      : l.luckPct > 0
        ? { cls: 'lucky', text: `Lucky parse: good crit/hit${spells ? '/resist' : ''} rolls and procs added about ${fmt(l.luckDps)} DPS (${fmtSigned(l.luckPct, 1)}%).` }
        : { cls: 'unlucky', text: `Unlucky parse: crit/hit${spells ? '/resist' : ''} rolls and procs cost you about ${fmt(-l.luckDps)} DPS (${fmtSigned(l.luckPct, 1)}%). Part of your gap is RNG, not play.` };
  const parts = [
    { label: 'the rolls themselves', v: l.directDps },
    { label: `knock-on (${knockOn}...)`, v: l.knockOnDps },
    { label: 'trinket/enchant procs', v: l.procLuckDps },
  ].filter((p) => Math.abs(p.v) >= 1);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Was it luck?</h2>
          <p className="sub">
            Your actual crits, {spells ? 'misses, full and partial resists' : 'misses/dodges/parries'} and proc uptimes compared with what the sim expects from your gear, buffs and talents. The sim is re-run as if it had rolled like you, so effects like {knockOn} count too. {G.Noun} averaged {fmtSigned(topLuck, 1)}% from luck, as you'd expect for the best parses.
          </p>
        </div>
      </div>
      <div className={`verdict ${verdict.cls}`}>{verdict.text}</div>
      <div className={`luck-grid ${spells ? 'five' : ''}`}>
        <div className="luck-stat">
          <span className="eyebrow">Crit rate</span>
          <span className="v">{fmt(l.critPct, 1)}%</span>
          <span className="muted small">
            expected {fmt(l.expectedCritPct, 1)}% · {Math.abs(z) < 1 ? 'normal' : `${fmt(Math.abs(z), 1)} SD ${z > 0 ? 'above' : 'below'}`}
          </span>
        </div>
        <div className="luck-stat">
          <span className="eyebrow">{spells ? 'Missed / fully resisted' : 'Missed / avoided'}</span>
          <span className="v">{fmt(l.avoidPct, 1)}%</span>
          <span className="muted small">expected {fmt(l.expectedAvoidPct, 1)}%</span>
        </div>
        {spells && (
          <div className="luck-stat">
            <span className="eyebrow">Partial resists</span>
            <span className="v">{fmt(l.resistPct!, 1)}%</span>
            <span className="muted small">
              of damage · expected {fmt(l.expectedResistPct!, 1)}%
            </span>
          </div>
        )}
        <div className="luck-stat">
          <span className="eyebrow">
            DPS from luck
            <Hint text="Crits, misses, resists and trinket/enchant procs compared with what the sim expects for your setup, turned into DPS. The best parses usually have +5-15%: they're each player's luckiest kill." />
          </span>
          <span className={`v ${l.luckDps >= 0 ? 'tone-good' : 'tone-bad'}`}>{fmtSigned(l.luckDps)}</span>
          <span className="muted small">
            {fmtSigned(l.luckPct, 1)}% of your DPS
            {parts.length > 1 && <> · {parts.map((p) => `${fmtSigned(p.v)} ${p.label}`).join(', ')}</>}
          </span>
        </div>
        <div className="luck-stat">
          <span className="eyebrow">
            Execution, luck removed
            <Hint text={`Execution with the luck taken out of everyone's DPS, you and ${G.noun}. This is the fairest view of how well the setup was played.`} />
          </span>
          <span className="v">{fmt(you.luckAdjustedPct)}%</span>
          <span className="muted small">vs {fmt(you.relativePct)}% with luck</span>
        </div>
      </div>
      {l.procs.length > 0 && (
        <div className="table-scroll">
          <table className="t">
            <thead>
              <tr>
                <th>Proc</th>
                <th>From</th>
                <th className="num">Uptime</th>
                <th className="num">Expected</th>
              </tr>
            </thead>
            <tbody>
              {l.procs.map((p) => (
                <tr key={p.name + p.item}>
                  <td className="strong">{p.name}</td>
                  <td className="muted">{p.item}</td>
                  <td className={`num ${p.uptimePct - p.expectedUptimePct >= 3 ? 'tone-good' : p.uptimePct - p.expectedUptimePct <= -3 ? 'tone-bad' : ''}`}>{fmt(p.uptimePct)}%</td>
                  <td className="num muted">{fmt(p.expectedUptimePct)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {l.abilities.length > 0 && (
        <div className="table-scroll">
          <table className="t">
            <thead>
              <tr>
                <th>Ability</th>
                <th className="num">Crit</th>
                <th className="num">Expected</th>
                <th className="num">{spells ? 'Missed' : 'Avoided'}</th>
                <th className="num">Expected</th>
                {showResists && <th className="num">Resisted</th>}
                {showResists && <th className="num">Expected</th>}
                <th className="num">DPS from luck</th>
              </tr>
            </thead>
            <tbody>
              {l.abilities.map((a, i) => (
                // Main- and off-hand hits of one ability share a name.
                <tr key={`${a.name}-${i}`}>
                  <td className="strong">{a.name}</td>
                  <td className="num">{fmt(a.critPct, 1)}%</td>
                  <td className="num muted">{fmt(a.expectedCritPct, 1)}%</td>
                  <td className="num">{fmt(a.avoidPct, 1)}%</td>
                  <td className="num muted">{fmt(a.expectedAvoidPct, 1)}%</td>
                  {showResists && <td className="num">{a.resistPct !== undefined ? `${fmt(a.resistPct, 1)}%` : '–'}</td>}
                  {showResists && <td className="num muted">{a.expectedResistPct !== undefined ? `${fmt(a.expectedResistPct, 1)}%` : '–'}</td>}
                  <td className={`num strong ${a.luckDps >= 0 ? 'tone-good' : 'tone-bad'}`}>{fmtSigned(a.luckDps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
