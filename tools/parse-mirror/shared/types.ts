// Types shared between the server and the web UI.

export interface FightRef {
  report: string;
  fight: number;
  /** Warcraft Logs actor ID of the player. */
  source: number;
}

export interface GearItem {
  slot: string;
  id: number;
  name: string;
  icon: string;
  quality: number;
  itemLevel: number;
  enchantId?: number;
  enchantName?: string;
  /** Temporary enchant (sharpening stone, oil, etc.) effect ID. */
  tempEnchantId?: number;
  tempEnchantName?: string;
  gems: { id: number; name: string; icon: string }[];
}

export interface AuraUptime {
  id: number;
  name: string;
  icon?: string;
  uptimePct: number;
  uses: number;
  /** Seconds into the fight each time the aura was gained. */
  starts?: number[];
  /** Not in the log; a totem from a shaman in the player's party. */
  fromPartyShaman?: boolean;
  /** A party shaman's usual totem, assumed up all fight because pre-pull casts aren't logged. */
  assumed?: boolean;
}

export interface AbilityCasts {
  id: number;
  name: string;
  icon?: string;
  casts: number;
  perMinute: number;
}

export interface ConsumeUse {
  category: ConsumeCategory;
  name: string;
  /** WoWSims consumable item ID (or imbue spell ID), for consumes set by ID. */
  simId?: number;
  /** Whether the sim models this consume (by ID or by a flag like superSapper). */
  simulated: boolean;
  /** Icon of the buff, cast or item it was found from. */
  icon?: string;
}

export type ConsumeCategory =
  | 'Flask'
  | 'Battle Elixir'
  | 'Guardian Elixir'
  | 'Food'
  | 'Scroll'
  | 'Potion'
  | 'Engineering'
  | 'Drums'
  | 'Weapon (MH)'
  | 'Weapon (OH)'
  | 'Other';

export const CONSUME_CATEGORIES: ConsumeCategory[] = [
  'Flask',
  'Battle Elixir',
  'Guardian Elixir',
  'Food',
  'Scroll',
  'Potion',
  'Engineering',
  'Drums',
  'Weapon (MH)',
  'Weapon (OH)',
  'Other',
];

export interface CooldownUse {
  name: string;
  icon?: string;
  /** Seconds into the fight of each use. */
  times: number[];
}

export interface PlayerFight {
  name: string;
  server?: string;
  report: string;
  fight: number;
  source: number;
  rank?: number;
  className: string;
  specName: string;
  race: string;
  durationSec: number;
  kill: boolean;
  totalDamage: number;
  dps: number;
  /** DPS without damage the sim can't model (e.g. a summoned Infernal). */
  simComparableDps: number;
  avgItemLevel: number;
  talentSplit: [number, number, number];
  /** Talent string used for sims, and where it came from. */
  talents: string;
  talentSource: 'armory' | 'preset';
  gear: GearItem[];
  buffs: AuraUptime[];
  casts: AbilityCasts[];
  consumes: ConsumeUse[];
  cooldowns: CooldownUse[];
  /** Share of the fight spent casting or on the GCD, 0..100. */
  activePct: number;
  /** Idle stretches between casts/GCDs, longest first (seconds into the fight). */
  gaps: { start: number; duration: number }[];
  idleSec: number;
  /** Share of direct shadow hits that had Improved Shadow Bolt (0..100), when it can be told. */
  isbHitPct?: number;
  /** Rage classes: rage per minute from damage taken, and what most of that damage was. */
  rageFromDamageTaken?: { perMinute: number; mainSource?: string };
  /** DPS of a shadow priest in the player's party (their Vampiric Touch gives the party mana). */
  partyShadowPriestDps?: number;
  /** Hit chance from rating, talents and party auras, against the cap for a raid boss. */
  hit?: { pct: number; capPct: number; fromRating: number; extras: string[] };
  /**
   * Power Infusion from a priest: times received, and the DPS it's estimated to have added (20%
   * cast speed for 15 s, which doesn't stack with Bloodlust).
   */
  powerInfusion?: { uses: number; dps: number };
  /** Casts / max possible casts for core rotational abilities, 0..100. */
  abilityEfficiency: { name: string; pct: number }[];
  bossDebuffs: AuraUptime[];
  /** Debuffs this player kept on the boss (curses, DoTs), for specs that track them. */
  ownDebuffs: AuraUptime[];
}

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  severity: Severity;
  area: 'Rotation' | 'Cooldowns' | 'Consumes' | 'Gear' | 'Talents' | 'Fight' | 'Buffs';
  title: string;
  detail: string;
}

export interface MetricRow {
  key: string;
  label: string;
  icon?: string;
  unit?: string;
  you: number;
  median: number;
  min: number;
  max: number;
  /** Values for each top player, in rank order (null when they had none). */
  top: (number | null)[];
  /** Whether a higher value is better (for colouring); null = neutral. */
  higherIsBetter: boolean | null;
  /** Decimals to show (default: 0 for % and s, else 1). */
  digits?: number;
}

/** Who you're compared with, and the words for them used throughout the page. */
export interface ComparisonGroup {
  mode: 'top' | 'peers';
  /** Toggle label, e.g. "Top 10" or "Same gear, a step ahead". */
  label: string;
  /** One-line description of how the group was picked. */
  description: string;
  /** "top players" / "players a step ahead" */
  players: string;
  /** Short prefix for labels: "Top 10" / "Peer" */
  short: string;
}

export interface AnalysisResult {
  id: string;
  comparison: ComparisonGroup;
  generatedAt: string;
  encounter: { id: number; name: string };
  spec: { className: string; specName: string; caster: boolean; activityLabel: string };
  you: PlayerFight;
  top: PlayerFight[];
  metrics: {
    summary: MetricRow[];
    casts: MetricRow[];
    uptimes: MetricRow[];
    efficiency: MetricRow[];
  };
  findings: Finding[];
  warnings: string[];
}

export interface SimScenarioResult {
  key: string;
  label: string;
  description: string;
  /** Exactly what this scenario changed compared with your setup. */
  changes?: string[];
  dps: number;
  stdev: number;
  deltaVsBaseline: number;
}

export interface LuckSummary {
  /** DPS gained (+) or lost (-) from RNG for this setup: direct + knock-on + procs. */
  luckDps: number;
  luckPct: number;
  /** Damage of the extra (or missing) crits, hits and resists themselves. */
  directDps: number;
  /** What those rolls did beyond their own damage: rage, Flurry, Improved Shadow Bolt... */
  knockOnDps: number;
  /** Trinket, enchant and set bonus procs that were up more (+) or less (-) than the sim expects. */
  procLuckDps: number;
  procs: { name: string; item: string; uptimePct: number; expectedUptimePct: number }[];
  critPct: number;
  expectedCritPct: number;
  /** Standard deviations from the expected crit count (|z| > 2 is unusual). */
  critZ: number;
  avoidPct: number;
  expectedAvoidPct: number;
  /** Spells: share of direct damage lost to partial resists, actual vs expected (0..100). */
  resistPct?: number;
  expectedResistPct?: number;
  resistLuckDps?: number;
  abilities: {
    name: string;
    critPct: number;
    expectedCritPct: number;
    avoidPct: number;
    expectedAvoidPct: number;
    resistPct?: number;
    expectedResistPct?: number;
    luckDps: number;
  }[];
}

export interface SimPlayerResult {
  name: string;
  rank?: number;
  actualDps: number;
  simDps: number;
  /** The sim of this player's setup on your kill time (the difference to simDps is kill length). */
  simDpsOnYourTime?: number;
  durationSec?: number;
  /** Actual DPS as a percentage of what the sim says their setup could do. */
  executionPct: number;
  /** executionPct relative to the top players' median (100 = as well as the median top player). */
  relativePct: number;
  luck: LuckSummary;
  /** relativePct with luck taken out of the actual DPS. */
  luckAdjustedPct: number;
}

export interface SimResult {
  analysisId: string;
  iterations: number;
  scenarios: SimScenarioResult[];
  execution: SimPlayerResult[];
  notes: string[];
  /** What the player's crits and hits feed, for the luck panel ("rage, Flurry"). */
  knockOn?: string;
}

/** One boss kill in a player's raid overview. */
export interface RaidBoss {
  fight: number;
  encounterId: number;
  name: string;
  durationSec: number;
  dps: number;
  /** Warcraft Logs parse percentile for this kill, if ranked. */
  percentile?: number;
  topMedianDps?: number;
  topMedianDurationSec?: number;
  /** The player's previous ranked kill of this boss (before this one), and their best this tier. */
  previous?: { percentile: number; startTime: number };
  bestPercentile?: number;
  /** Place among the raid's DPS players on this kill (1 = most damage). */
  raidRank?: { rank: number; of: number };
  /** DPS of the comparison players (RaidSummary.peers) on this kill, by source. */
  peerDps: Record<number, number>;
  consumes?: GuildFight['consumes'];
  potions: GuildFight['potions'];
  /** The player's party on this kill (members by source, guessed ones flagged). */
  party?: RaidParty;
  /** The raid debuffs that raise this player's damage, with their uptime on this kill. */
  debuffs: { name: string; icon: string; uptime: number; target: number }[];
}

export interface GuildSummary {
  report: string;
  title: string;
  bosses: { fight: number; encounterId: number; name: string; durationSec: number }[];
  players: {
    source: number;
    name: string;
    server?: string;
    icon: string;
    /** Full analysis available for this spec. */
    supported: boolean;
    /** Parses on DPS (not a healer or tank spec). */
    dps: boolean;
    /** By fight id, for the kills the player was in. */
    fights: Record<number, GuildFight>;
    /** Gear problems on their latest kill (missing enchants, empty sockets, hit under the cap). */
    gearIssues: GearIssue[];
  }[];
  /** Who was in which party, per kill, with what the party was missing. */
  parties: { fight: number; groups: RaidParty[] }[];
  /** Raid debuffs on the boss: uptime per kill. Only debuffs someone in the raid can bring. */
  debuffs: { name: string; icon: string; by: string; uptime: Record<number, number>; /** Uptime % that counts as good. */ target: number }[];
}

export interface GuildFight {
  dps: number;
  percentile?: number;
  /** Pre-pull buffs; missing when the player was out of logging range at the pull. */
  consumes?: {
    /** Flask, or a battle plus a guardian elixir: 'full'. One elixir only: 'half'. */
    flask: 'full' | 'half' | 'none';
    food: boolean;
    weapon?: boolean;
    /** Flask, elixirs, food, weapon oils/stones and scrolls found at the pull. */
    used: { name: string; icon?: string; category: 'Flask' | 'Elixir' | 'Food' | 'Weapon' | 'Scroll' }[];
  };
  /** Potions, runes and similar used from just before the pull to the kill. */
  potions: { name: string; icon?: string }[];
}

export interface GearIssue {
  kind: 'enchant' | 'socket' | 'gem' | 'hit';
  slot?: string;
  item?: { id: number; name: string; icon: string; quality: number };
  text: string;
}

export interface RaidParty {
  members: number[];
  /** Members placed by guess (nothing in the log tied them to a party); also in `members`. */
  guessed: number[];
  /** Drums used in the party on this kill. */
  drums: number;
  drumIcon?: string;
  /** Problems with the party's setup, e.g. melee without a shaman. */
  notes: string[];
}

export interface ProgressSummary {
  report: string;
  player: { name: string; server?: string; region?: string; icon: string; source: number };
  bosses: {
    encounterId: number;
    name: string;
    /** Oldest first. */
    kills: { report: string; fight: number; startTime: number; percentile: number; dps: number; durationSec: number; itemLevel?: number; spec: string }[];
  }[];
}

export interface RaidSummary {
  report: string;
  title: string;
  player: { name: string; server?: string; icon: string; source: number; supported: boolean; dps: boolean };
  bosses: RaidBoss[];
  /** Who the player is compared with in their own raid: the same class, or else the top DPS of the same role. */
  peers: { basis: 'class' | 'role'; players: { source: number; name: string; icon: string }[] };
  /** Names and class icons of everyone in the player's parties, for the party column. */
  people: Record<number, { name: string; icon: string }>;
  /** Gear problems on the latest kill. */
  gearIssues: GearIssue[];
}
