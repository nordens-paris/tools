// Words for who the fight is compared with ("Top 10" / "Peer", "top players" / "players a step
// ahead"), so every panel says the same thing.
import { createContext, useContext } from 'react';

import type { ComparisonGroup } from '../../shared/types.ts';

export const GroupContext = createContext<Pick<ComparisonGroup, 'short' | 'players'>>({ short: 'Top 10', players: 'top players' });

export function useGroup() {
  const g = useContext(GroupContext);
  // "Top 10" reads as a noun on its own; "Peer" needs one ("the peers").
  const noun = g.short === 'Top 10' ? 'the top 10' : 'the peers';
  return { ...g, noun, Noun: noun[0].toUpperCase() + noun.slice(1) };
}
