// TBC spell names, without reading files at runtime: the healer and tank analyses also run in the
// browser (web/src/roleBrowser.ts), so the data comes in as an import.
import names from '../../data/wowsims/spell-names.json' with { type: 'json' };

/** The TBC name of a spell, falling back to the name Warcraft Logs gave. */
export const spellName = (id: number, fallback: string) => (names as Record<string, string>)[id] ?? fallback;
