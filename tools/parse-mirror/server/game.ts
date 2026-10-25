// Everything that depends on which game version the tool is pointed at, in one place. Switching
// to another version (e.g. WoW Forever) should mostly be a new profile here plus GAME=<id> in .env.
// Class and spec logic lives in server/specs/, the sim in WoWSims (one build per game version).

export interface GameProfile {
  id: string;
  name: string;
  /** Warcraft Logs site the reports, rankings and API live on. */
  wclHost: string;
  /** Warcraft Logs adds this to encounter IDs on some sites (Fresh: 50000). */
  encounterIdOffset: number;
  /** Wowhead path for item links and tooltips (wowhead.com/<path>/item=...). */
  wowheadPath: string;
  /** classic-armory.org "flavor" for talent lookups; undefined turns the armory off. */
  armoryFlavor?: string;
  boss: {
    level: number;
    defaultArmor: number;
    /** Base armor by encounter ID (without the offset). */
    armor: Record<number, number>;
    /** WoWSims creature type by encounter ID; matters for gear like Mark of the Champion. */
    mobType: Record<number, string>;
  };
}

// Boss armor is a fan-compiled table from https://legacy-wow.com/?p=402; anything not listed uses
// WoWSims' default raid boss armor. Keyed by ID because non-English logs have localized names.
const TBC_BOSSES: GameProfile['boss'] = {
  level: 73,
  defaultArmor: 7685,
  armor: {
    623: 7700, // Hydross the Unstable
    624: 7700, // The Lurker Below
    625: 7700, // Leotheras the Blind
    626: 6200, // Fathom-Lord Karathress
    627: 7700, // Morogrim Tidewalker
    628: 6200, // Lady Vashj
    730: 7700, // Al'ar
    731: 8800, // Void Reaver
    732: 6200, // High Astromancer Solarian
    733: 6200, // Kael'thas Sunstrider
    618: 6200, // Rage Winterchill
    619: 6200, // Anetheron
    620: 6200, // Kaz'rogal
    621: 6200, // Azgalor
    622: 6200, // Archimonde
    601: 7700, // High Warlord Naj'entus
    602: 7700, // Supremus
    603: 7700, // Shade of Akama
    604: 6200, // Teron Gorefiend
    605: 7700, // Gurtogg Bloodboil
    606: 7700, // Reliquary of Souls
    607: 6200, // Mother Shahraz
    608: 6200, // The Illidari Council
    609: 7700, // Illidan Stormrage
  },
  mobType: {
    623: 'MobTypeElemental', // Hydross
    625: 'MobTypeDemon', // Leotheras
    626: 'MobTypeHumanoid', // Karathress
    628: 'MobTypeHumanoid', // Vashj
    731: 'MobTypeMechanical', // Void Reaver
    732: 'MobTypeHumanoid', // Solarian
    733: 'MobTypeHumanoid', // Kael'thas
    618: 'MobTypeUndead', // Rage Winterchill
    619: 'MobTypeDemon', // Anetheron
    620: 'MobTypeDemon', // Kaz'rogal
    621: 'MobTypeDemon', // Azgalor
    622: 'MobTypeDemon', // Archimonde
    601: 'MobTypeHumanoid', // Naj'entus
    602: 'MobTypeDemon', // Supremus
    604: 'MobTypeUndead', // Teron Gorefiend
    605: 'MobTypeDemon', // Gurtogg
    607: 'MobTypeDemon', // Shahraz
    608: 'MobTypeHumanoid', // Council
    609: 'MobTypeDemon', // Illidan
  },
};

const PROFILES: Record<string, GameProfile> = {
  'tbc-anniversary': {
    id: 'tbc-anniversary',
    name: 'TBC Anniversary',
    wclHost: 'fresh.warcraftlogs.com',
    encounterIdOffset: 50000,
    wowheadPath: 'tbc',
    armoryFlavor: 'tbc-anniversary',
    boss: TBC_BOSSES,
  },
  // Placeholder until WoW Forever's details are known: set WCL_HOST, check the encounter IDs,
  // boss table and armory flavor, and point WOWSIMS_CLI at a matching WoWSims build.
  forever: {
    id: 'forever',
    name: 'WoW Forever',
    wclHost: 'fresh.warcraftlogs.com',
    encounterIdOffset: 50000,
    wowheadPath: 'tbc',
    armoryFlavor: undefined,
    boss: TBC_BOSSES,
  },
};

const chosen = PROFILES[process.env.GAME ?? 'tbc-anniversary'];
if (!chosen) throw new Error(`Unknown GAME "${process.env.GAME}". Known: ${Object.keys(PROFILES).join(', ')}`);

export const game: GameProfile = { ...chosen, wclHost: process.env.WCL_HOST || chosen.wclHost };

/** Encounter ID without the site's offset. */
export const baseEncounterId = (id: number) => (game.encounterIdOffset ? id % game.encounterIdOffset : id);

/** What the web UI needs to know. */
export const publicGameConfig = () => ({ id: game.id, name: game.name, wclHost: game.wclHost, wowheadPath: game.wowheadPath });
