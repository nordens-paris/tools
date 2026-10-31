import type { AnalysisResult, GearItem } from '../../../shared/types.ts';
import { QUALITY_CLASS, itemIcon, wowheadItem } from '../format.ts';
import { useGroup } from '../group.ts';

const SLOTS = ['Head', 'Neck', 'Shoulder', 'Back', 'Chest', 'Wrist', 'Hands', 'Waist', 'Legs', 'Feet', 'Finger 1', 'Finger 2', 'Trinket 1', 'Trinket 2', 'Main Hand', 'Off Hand', 'Ranged'];
const PAIRED = (slot: string) => slot.replace(/ \d$/, '');

export function Gear({ analysis }: { analysis: AnalysisResult }) {
  const G = useGroup();
  const withGear = analysis.top.filter((p) => p.gear.length);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Gear vs {G.noun}</h2>
          <p className="sub">Your item in each slot next to the most popular item among {G.noun}. Hover an item for its Wowhead tooltip.</p>
        </div>
      </div>
      <div>
        <div className="gear-row gear-head">
          <div>Slot</div>
          <div>Your item</div>
          <div>Most popular in {G.noun}</div>
        </div>
        {SLOTS.map((slot) => {
          const mine = analysis.you.gear.find((g) => g.slot === slot);
          // Rings and trinkets are compared as pairs: slot 1 vs the most popular, slot 2 vs the next.
          const counts = new Map<number, { item: GearItem; n: number }>();
          for (const p of withGear) {
            for (const g of p.gear.filter((x) => PAIRED(x.slot) === PAIRED(slot))) {
              if (PAIRED(slot) === slot && g.slot !== slot) continue;
              const e = counts.get(g.id);
              if (e) e.n++;
              else counts.set(g.id, { item: g, n: 1 });
            }
          }
          const sorted = [...counts.values()].sort((a, b) => b.n - a.n);
          const popular = slot.endsWith(' 2') ? sorted[1] : sorted[0];
          const missingEnchant = mine?.canEnchant && !mine.enchantId;
          return (
            <div key={slot} className="gear-row">
              <div className="muted small">{slot}</div>
              <div>{mine ? <ItemCell item={mine} warn={missingEnchant ? 'No enchant' : undefined} /> : <span className="missing">Empty</span>}</div>
              <div>
                {popular ? (
                  <div className="popular">
                    <ItemCell item={popular.item} same={popular.item.id === mine?.id} />
                    <span className="pill">
                      {popular.n}/{withGear.length}
                    </span>
                  </div>
                ) : (
                  <span className="missing">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ItemCell({ item, warn, same }: { item: GearItem; warn?: string; same?: boolean }) {
  return (
    <div className="item">
      <img src={itemIcon(item.icon)} alt="" className={`item-icon ${QUALITY_CLASS[item.quality]}`} />
      <div style={{ minWidth: 0 }}>
        <a href={wowheadItem(item.id, item.enchantId, item.gems.map((g) => g.id))} target="_blank" rel="noreferrer" className={`item-name ${QUALITY_CLASS[item.quality]}`}>
          {item.name}
        </a>
        {same && <span className="same">same as yours</span>}
        <div className="item-sub">
          <span className="mono">ilvl {item.itemLevel}</span>
          {item.enchantName && <span className="enchant">{item.enchantName}</span>}
          {item.tempEnchantName && <span>· {item.tempEnchantName}</span>}
          {warn && <span className="warn-text">{warn}</span>}
        </div>
        {item.gems.length > 0 && (
          <div className="gems">
            {item.gems.map((g, i) => (
              <img key={i} src={itemIcon(g.icon)} alt={g.name} title={g.name} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
