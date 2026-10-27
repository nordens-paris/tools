// Game version settings from the server (server/game.ts), loaded before the app renders.
export const game = {
  id: 'tbc-anniversary',
  name: 'TBC Anniversary',
  wclHost: 'fresh.warcraftlogs.com',
  wowheadPath: 'tbc',
  /** Where sims run: in this browser (WebAssembly) or on the server. */
  simMode: 'browser' as 'browser' | 'cli',
  /** Healer and tank views only run on the visitor's own Warcraft Logs key (the hosted site). */
  rolesNeedOwnKey: false,
};

export async function loadGame() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) Object.assign(game, await res.json());
  } catch {
    // Keep the defaults; links still work for TBC Anniversary.
  }
}
