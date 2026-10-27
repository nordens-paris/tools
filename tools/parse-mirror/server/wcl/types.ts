// Shapes of the Warcraft Logs v1 API responses we use (only the fields we read).

export interface WclFight {
  id: number;
  boss: number;
  start_time: number;
  end_time: number;
  name: string;
  kill?: boolean;
}

export interface WclActor {
  id: number;
  name: string;
  type: string;
  icon: string;
  server?: string;
  fights: { id: number }[];
}

export interface WclFightsResponse {
  title: string;
  lang: string;
  /** Report start/end, epoch ms. A report that ended recently may still be logging. */
  start?: number;
  end?: number;
  /** Warcraft Logs zone (raid tier) of the report. */
  zone?: number;
  fights: WclFight[];
  friendlies: WclActor[];
  enemies: WclActor[];
  friendlyPets?: (WclActor & { petOwner: number })[];
}

export interface WclTableEntry {
  guid: number;
  /** Actor id, in tables not split by ability (e.g. damage done by everyone). */
  id?: number;
  name: string;
  abilityIcon?: string;
  total: number;
  type?: number;
  uses?: number;
  hitCount?: number;
  missCount?: number;
}

export interface WclTableEntries {
  totalTime: number;
  entries: WclTableEntry[];
}

export interface WclAura {
  guid: number;
  name: string;
  abilityIcon?: string;
  totalUptime: number;
  totalUses: number;
  /** When the aura was up (buffs/debuffs tables). */
  bands?: { startTime: number; endTime: number }[];
}

export interface WclTableAuras {
  totalTime: number;
  auras: WclAura[];
}

export interface WclEvent {
  timestamp: number;
  type: string;
  sourceID?: number;
  targetID?: number;
  /** type is the spell school bitmask (32 = shadow). */
  ability?: { guid: number; name: string; type?: number; abilityIcon?: string };
  [key: string]: unknown;
}

export interface WclGear {
  id: number;
  itemLevel?: number;
  quality?: number;
  icon?: string;
  permanentEnchant?: number;
  temporaryEnchant?: number;
  gems?: { id: number }[];
}

export interface WclCombatantInfo extends WclEvent {
  type: 'combatantinfo';
  faction: number;
  gear: WclGear[];
  talents: { id: number }[];
  auras: { ability: number; name?: string; source?: number; icon?: string }[];
  hitSpell?: number;
  hitMelee?: number;
}

export interface WclRanking {
  name: string;
  class: number;
  spec: number;
  total: number;
  duration: number;
  reportID: string;
  fightID: number;
  serverName: string;
  regionName: string;
  guildName?: string;
  itemLevel?: number;
  hidden?: boolean;
}

export interface WclRankingsResponse {
  count: number;
  hasMorePages: boolean;
  rankings: WclRanking[];
}

/** A whole raid's kill in the speed/execution rankings. */
export interface WclRaidRanking {
  reportID: string;
  fightID: number;
  /** Pull and report start, epoch ms: startTime - reportStart is the fight's start in the report. */
  startTime: number;
  reportStart: number;
  duration: number;
  /** Raid-wide damage taken over the kill. */
  damageTaken: number;
  deaths: number;
  tanks: number;
  healers: number;
  melee: number;
  ranged: number;
  size: number;
  guildName?: string;
  serverName: string;
  regionName: string;
}

export interface WclRaidRankingsResponse {
  count: number;
  hasMorePages: boolean;
  rankings: WclRaidRanking[];
}

export interface WclParse {
  encounterID: number;
  encounterName: string;
  spec: string;
  reportID: string;
  fightID: number;
  characterName: string;
  server: string;
  percentile: number;
  total: number;
  duration: number;
  startTime: number;
  /** Item level on the kill. */
  ilvlKeyOrPatch?: number;
  /** Rank among all parses of the spec on this boss, and how many there are. */
  rank?: number;
  outOf?: number;
}
