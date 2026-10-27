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
  /** Healer analyses say kind: 'healer'; DPS ones leave it out. */
  kind?: 'dps';
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
  /** The player's healing on this kill, when they healed. */
  healing?: HealerRaidRow;
  /** The player's tanking on this kill, when they tanked. */
  tanking?: TankRaidRow;
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
  /** healer: they healed on most kills; the boss table then shows healing instead of DPS. */
  /** healer / tank: they healed or tanked on most kills. healerLocked: may be a healer or tank, but
   * those views need the visitor's own key on this site. */
  player: { name: string; server?: string; icon: string; source: number; supported: boolean; dps: boolean; healer?: boolean; tank?: boolean; healerLocked?: boolean };
  bosses: RaidBoss[];
  /** Who the player is compared with in their own raid: the same class, or else the top DPS of the same role. */
  peers: { basis: 'class' | 'role'; players: { source: number; name: string; icon: string }[] };
  /** Names and class icons of everyone in the player's parties, for the party column. */
  people: Record<number, { name: string; icon: string }>;
  /** Gear problems on the latest kill. */
  gearIssues: GearIssue[];
}

// ---- Healers ---------------------------------------------------------------------------------

/** Where a healer's effective healing went: mostly tanks, mostly the raid, or both. */
export type HealerRole = 'tank' | 'mixed' | 'raid';

export interface HealerSpellRow {
  name: string;
  icon?: string;
  casts: number;
  /** Mana spent on the casts. */
  mana: number;
  effective: number;
  overheal: number;
  hits: number;
  /** Spell IDs cast, when more than one rank was used. */
  ranks?: number[];
}

export interface HealerCooldownUse {
  name: string;
  icon?: string;
  atSec: number;
  /** Healer's mana (0-1) just before. */
  manaPct?: number;
  /** Cast by someone else on the healer (Innervate, Power Infusion). */
  from?: string;
}

export interface HealerUpkeep {
  name: string;
  icon?: string;
  /** The target it was kept on the most. */
  target: string;
  /** Uptime on that target, 0-1. */
  uptime: number;
  targets: number;
  /** Lifebloom: share of the fight at 3 stacks on that target. */
  stack3?: number;
}

/** Overheal by cause, as shares (0-1) of the healer's overheal. */
export interface OverhealSplit {
  /** Heal bigger than the gap when the healer committed (cast start, or landing for instants). */
  ownChoice: number;
  /** The gap was there at cast start, but other heals filled it before this one landed. */
  othersFilled: number;
  chainHealBounces: number;
  hotTicks: number;
  /** Prayer of Mending, Earth Shield: fire on their own when damage lands. */
  procHeals: number;
}

export interface HealerMetrics {
  source: number;
  name: string;
  /** Kill length, for rows that would otherwise favour shorter kills. */
  durationSec: number;
  /** Class-spec icon, e.g. "Priest-Holy". */
  icon: string;
  specLabel: string;
  hps: number;
  effective: number;
  /** Shield absorbs, included in effective. */
  absorbed: number;
  /** Share of the healer's direct heals that was overheal (0-1). */
  overhealPct: number;
  /** Share of the raid's effective healing. */
  shareOfRaid: number;
  role: HealerRole;
  /** Share of effective healing on tanks (players tanking the boss). */
  tankShare: number;
  /** The same, counting only tank-spec players: matches how peers are picked. */
  tankShareIcon: number;
  topTargets: { name: string; icon: string; share: number }[];
  mana?: {
    max: number;
    spent: number;
    /** Mana 0-1 over the fight, one point per few seconds. */
    curve: { t: number; pct: number }[];
    lowest: number;
    end: number;
    secBelow10: number;
    /** Effective healing per point of mana spent. */
    healPerMana: number;
  };
  manaGained: { name: string; amount: number }[];
  /** Mana gains lost to a full mana bar. */
  manaWasted: number;
  cooldowns: HealerCooldownUse[];
  spells: HealerSpellRow[];
  overheal: OverhealSplit;
  castsClean: number;
  castsWithOverheal: number;
  cancels: { count: number; started: number; secLost: number; likelyTopped: number };
  /** Heals on tanks started at 90%+ HP, vs heals started after the damage. */
  tankPreheal?: { preheals: number; reactive: number; prehealEffective?: number; reactiveEffective?: number };
  reaction: { drops: number; answered: number; medianSec?: number; firstResponder?: number };
  saves: number;
  /** Share of the time alive spent casting (0-1). */
  activity: number;
  /** Seconds not casting while someone they heal was below 70%. */
  idleWhileNeeded: { sec: number; ofSec: number };
  upkeep: HealerUpkeep[];
  dispels: number;
  context: { raidHealers: number; raidDtps: number; healPerRaidDamage: number };
}

export interface HealerDeath {
  player: string;
  icon: string;
  atSec: number;
  killedBy: string;
  /** burst: from 60%+ in one hit; fast: under 2 s below 50%; window: time to save them. */
  kind: 'burst' | 'fast' | 'window';
  secBelow50?: number;
  /** The killing ability hits on a timer (seconds between). */
  periodicSec?: number;
  damage5s: { name: string; amount: number }[];
  /** HP % in the last seconds, [seconds before death, pct]. */
  hp: [number, number][];
  /** What each healer cast in the window. */
  healers: { name: string; casts: string[] }[];
}

export interface HealerFightSummary {
  fight: number;
  encounter: { id: number; name: string };
  durationSec: number;
  tanks: { name: string; icon: string }[];
  raid: { effective: number; hps: number; dtps: number; healers: number };
  healers: HealerMetrics[];
  deaths: HealerDeath[];
}

export interface HealerPeer {
  name: string;
  server?: string;
  region?: string;
  report: string;
  fight: number;
  /** Which whole-raid ranking the raid came from, and its place there. */
  raidRanking: { metric: 'execution' | 'speed'; rank: number; guild?: string };
  raid: { healers: number; dtpsPerHealer: number; deaths: number; durationSec: number };
  tankShareIcon: number;
  /** Median percentile of their healing parses this tier, and how many kills. */
  consistency?: { median: number; kills: number };
}

export interface HealerPeerGroup {
  /** How strictly the peers match: same healers and damage, looser, or only the closest assignment. */
  match: 'close' | 'loose' | 'assignment' | 'none';
  description: string;
  you: { healers: number; dtpsPerHealer: number; role: HealerRole; tankShareIcon: number };
  peers: HealerPeer[];
  raidsChecked: number;
}

export type HealerTab = 'Overview' | 'Mana' | 'Spells' | 'Overheal' | 'Response' | 'Deaths' | 'Peers';

export interface HealerFinding {
  severity: Severity;
  tab: HealerTab;
  title: string;
  detail: string;
}

/** One compared number. null = no data for that player. */
export interface HealerRow {
  key: string;
  label: string;
  you: number | null;
  median: number | null;
  peers: (number | null)[];
  format: 'pct' | 'num' | 'sec' | 'int' | 'dec';
  /** Unset for context rows: shown, never judged. */
  higherIsBetter?: boolean;
  hint?: string;
}

export interface HealerSpellCompare {
  name: string;
  icon?: string;
  you: { share: number; healPerMana: number | null; casts: number; overheal: number };
  /** Peer medians; healPerMana only over peers who cast it. */
  peers: { share: number; healPerMana: number | null; overheal: number; users: number };
}

export interface HealerAnalysis {
  kind: 'healer';
  id: string;
  generatedAt: string;
  report: string;
  fight: number;
  encounter: { id: number; name: string };
  durationSec: number;
  kill: boolean;
  you: HealerMetrics;
  peers: (HealerMetrics & { peer: HealerPeer; durationSec: number })[];
  group: HealerPeerGroup;
  /** Compared and judged: fair whatever the raid around you. */
  judged: HealerRow[];
  /** Depends on the raid around you: shown for context only. */
  context: HealerRow[];
  spells: HealerSpellCompare[];
  findings: HealerFinding[];
  deaths: HealerDeath[];
  tanks: { name: string; icon: string }[];
  raid: { hps: number; dtps: number; healers: number };
  warnings: string[];
}

/** One healer on one kill, for the raid pages (no peers). */
export interface HealerRaidRow {
  source: number;
  name: string;
  icon: string;
  specLabel: string;
  role: HealerRole;
  tankShare: number;
  hps: number;
  healPerMana?: number;
  overhealPct: number;
  /** Overheal by the healer's own choice, as a share of all their healing. */
  ownOverheal: number;
  manaEnd?: number;
  /** Mana potions and runes. */
  potions: number;
  /** Other cooldowns used (Divine Favor, Nature's Swiftness...). */
  cooldowns: number;
  idleSec: number;
  saves: number;
}

export interface HealerRaidBoss {
  fight: number;
  name: string;
  durationSec: number;
  healers: number;
  dtpsPerHealer: number;
  deaths: Record<HealerDeath['kind'], number>;
  rows: HealerRaidRow[];
}

/** Every healer on every boss kill of a report. */
export interface HealerRaidSummary {
  report: string;
  bosses: HealerRaidBoss[];
}

// ---- Tanks -----------------------------------------------------------------------------------

/** Main tank: most of the boss's swings; off-tank: some; adds: mostly other enemies. */
export type TankRole = 'main' | 'off' | 'adds';

/** Outcomes of the swings a tank took from the enemy they tanked most. */
export interface TankSwings {
  total: number;
  hit: number;
  crit: number;
  crush: number;
  block: number;
  dodge: number;
  parry: number;
  miss: number;
  /** Miss + dodge + parry, as a share of swings. */
  avoided: number;
  /** Damage per swing that landed, and what it would have been before armor and block. */
  damagePerHit: number;
  unmitigatedPerHit: number;
}

export interface TankMitigationBuff {
  name: string;
  icon?: string;
  uptime: number;
  /** Share of the swings taken while it was up. */
  swingsCovered: number;
  /** Crushing blows taken while it was up / down. */
  crushesCovered: number;
  crushesUncovered: number;
}

export interface TankGear {
  /** Defense skill (350 base + rating + talents) and the crit reduction it gives. */
  defense: number;
  critReduction: number;
  /** Crit immune by gear (crits taken in the log say the same, or not). */
  critImmune: boolean;
  /** Share of the gear's stat budget on mitigation stats (stamina, armor, defense, avoidance, block). */
  mitigationLean: number;
  stats: Record<string, number>;
}

/** One of the tank's actions in the opener, in order. */
export interface TankOpenerAction {
  /** Seconds after the pull. */
  t: number;
  name: string;
  icon?: string;
  /** How it landed; 'cast' for abilities without a hit (Sunder Armor, Holy Shield, shouts). */
  outcome: 'hit' | 'crit' | 'block' | 'glance' | 'miss' | 'dodge' | 'parry' | 'resist' | 'cast';
  threat: number;
  /** Avoided attacks: the threat that ability usually does when it lands. */
  lost?: number;
  /** One of their own attacks (not damage from a buff like Thorns). */
  attack?: boolean;
  /** Uses a global cooldown. */
  gcd: boolean;
}

/**
 * The opener. Threat from the pull is what the DPS can open on; the rest is measured over the same
 * window from the tank's first attack, which is what's in their hands once in melee: bad luck
 * (attacks missed, dodged or parried, fewer crits than their usual rate) and the rotation (unused
 * global cooldowns, weaker abilities).
 */
export interface TankOpener {
  windowSec: number;
  /** Threat in the window from the pull. */
  pullThreat: number;
  /** Their first attack (auto attacks included) and the enemy's first swing on them, after the pull. */
  startSec?: number;
  bossSwingSec?: number;
  /** Their first ability (not an auto attack), after the pull. */
  firstActionSec?: number;
  /** Threat in the window from their first attack. */
  threat: number;
  /** Their own attacks in that window that could miss, and how many missed, were dodged or parried. */
  attacks: number;
  avoided: number;
  /** Avoided at their own rate over the rest of the kill. */
  expectedAvoided: number;
  /** Threat the avoided attacks would have done. */
  lostThreat: number;
  /** Crits among their attacks that landed, and what their crit rate over the rest of the kill gives. */
  crits: number;
  landed: number;
  expectedCrits: number;
  /** Threat bad luck cost, from avoids and from crits (negative: good luck gained threat). */
  avoidLuckThreat: number;
  critLuckThreat: number;
  luckThreat: number;
  /** Global cooldowns used in the window, of those available. */
  gcds: number;
  possibleGcds: number;
  /** Uses per ability in the window (their own abilities only). */
  abilities: Record<string, number>;
  /** Everything from the pull to the end of the window. */
  actions: TankOpenerAction[];
}

/** How the enemy they tanked swung at them, from the log; the tank sims are set up from this. */
export interface TankBossMelee {
  /** Average seconds between swings on them while they tanked (slows and parry haste included). */
  swingGapSec: number;
  /** Two weapons: about every other swing comes right after the one before. */
  dualWield: boolean;
  /** Average landed normal hit before armor and block. */
  hitBeforeArmor: number;
  swings: number;
}

export interface TankMetrics {
  source: number;
  name: string;
  icon: string;
  specLabel: string;
  className: string;
  role: TankRole;
  /** Who they tanked most (boss or add), and their share of that enemy's swings on players. */
  tanked: string;
  swingShare: number;
  survivability: {
    armor: number;
    /** Physical damage reduction from armor against a level 73 boss. */
    armorReduction: number;
    maxHp: number;
    maxHpFrom: 'damage' | 'stamina';
    /** Health / (1 - armor reduction). */
    effectiveHealth: number;
    stamina: number;
  };
  gear?: TankGear;
  swings: TankSwings;
  mitigation: TankMitigationBuff[];
  bossDebuffs: { name: string; icon?: string; uptime: number }[];
  /** Share of the fight in the tanking stance/form/aura, and in Cat Form (druids). */
  tankAuraUptime: number;
  catFormUptime?: number;
  cooldowns: { name: string; icon?: string; atSec: number; hpPct?: number }[];
  threatDrops: { name: string; atSec: number }[];
  taunts: { name: string; atSec: number; target?: string }[];
  threat: {
    tps: number;
    /** Threat per second over the first 5, 10 and 20 seconds. */
    opener: [number, number, number];
    /** Threat per second on the enemy they tanked (the sims have that one target). */
    onTanked: number;
    byAbility: { name: string; icon?: string; share: number }[];
  };
  /** The enemy they tanked: when it first swung, and how much it swung at players who aren't tanks.
   * Missing for peers: only your own raid's data shows who else the enemy hit. */
  holding?: { firstSwingSec?: number; firstSwingOnYou: boolean; swingsOnNonTanks: number; nonTankShare: number };
  dtps: number;
  /** Melee damage taken per second from the enemy they tanked. */
  meleeDtps: number;
  opener: TankOpener;
  bossMelee?: TankBossMelee;
  nearDeaths: number;
  died: boolean;
}

export interface TankFightSummary {
  fight: number;
  encounter: { id: number; name: string };
  durationSec: number;
  tanks: TankMetrics[];
}

export type TankTab = 'Overview' | 'Survivability' | 'Swings' | 'Mitigation' | 'Threat' | 'Cooldowns' | 'Sim' | 'Peers';

/** The opener next to the peers': fine, or held back mostly by a later start, bad luck or the rotation. */
export interface TankOpenerVerdict {
  /** 'mixed': no part is close to half the gap. */
  verdict: 'fine' | 'start' | 'luck' | 'rotation' | 'mixed';
  /** Threat per second from the pull: yours and the peers' median. */
  tps: number;
  peerTps: number;
  /** From your first attack, with your usual luck: yours and the peers' median. */
  engagedTps: number;
  peerEngagedTps: number;
  /**
   * The gap to the peers in threat per second, split into starting later than them, worse luck than
   * them, and the rest (rotation and gear). Negative parts went your way.
   */
  parts: { start: number; luck: number; rotation: number };
  /** Your and the peers' median first attack and first boss swing on you, seconds after the pull. */
  start: { you?: number; peers?: number; bossYou?: number; bossPeers?: number };
  reasons: string[];
}

/** One tank in the tank sims: what they did next to what WoWSims says their setup can do. */
export interface TankSimPlayer {
  name: string;
  you?: boolean;
  role: TankRole;
  swingShare: number;
  /** Threat per second on the boss: from the log, and simmed with their own gear and buffs. */
  actualTps: number;
  simTps: number;
  /** Actual ÷ simmed threat, and that next to the peers' median (100% = like the peers). */
  threatPct: number;
  relativePct: number;
  /** The same over the opener. */
  actualOpenerTps: number;
  simOpenerTps: number;
  openerPct: number;
  /** Melee damage taken per second from the boss while tanking it: from the log (melee taken ÷ share
   * of the boss's swings), and simmed. */
  actualDtps: number;
  simDtps: number;
}

export interface TankSimScenario {
  key: string;
  label: string;
  description: string;
  changes?: string[];
  tps: number;
  dtps: number;
  openerTps?: number;
  deltaTps: number;
  deltaDtps: number;
}

export interface TankSimResult {
  kind: 'tank';
  analysisId: string;
  iterations: number;
  /** The boss as the sims have it, set up from your raid's main tank. */
  boss: { from: string; swingSpeed: number; swingGapSec: number; dualWield: boolean; minBaseDamage: number; hitBeforeArmor: number };
  scenarios: TankSimScenario[];
  players: TankSimPlayer[];
  notes: string[];
  warnings: string[];
}

export interface TankFinding {
  severity: Severity;
  tab: TankTab;
  title: string;
  detail: string;
}

export interface TankPeer {
  name: string;
  server?: string;
  region?: string;
  report: string;
  fight: number;
  raidRanking: { metric: 'execution' | 'speed'; rank: number; guild?: string };
  raid: { tanks: number; healers: number; deaths: number; durationSec: number };
  /** Share of the boss's melee damage on players that this tank took. */
  swingShare: number;
}

export interface TankPeerGroup {
  match: 'close' | 'loose' | 'role' | 'none';
  description: string;
  you: { role: TankRole; tanks: number; durationSec: number };
  peers: TankPeer[];
  raidsChecked: number;
}

export interface TankAnalysis {
  kind: 'tank';
  id: string;
  generatedAt: string;
  report: string;
  fight: number;
  encounter: { id: number; name: string };
  durationSec: number;
  kill: boolean;
  you: TankMetrics;
  peers: (TankMetrics & { peer: TankPeer; durationSec: number })[];
  group: TankPeerGroup;
  /** Compared and judged. */
  judged: HealerRow[];
  /** Depends on the raid and the fight: shown, not judged. */
  context: HealerRow[];
  findings: TankFinding[];
  openerVerdict?: TankOpenerVerdict;
  /** Other tanks in your raid on this kill (name, role, share). */
  raidTanks: { name: string; icon: string; role: TankRole; swingShare: number }[];
  warnings: string[];
}

/** One tank on one kill, for the raid pages (no peers). */
export interface TankRaidRow {
  source: number;
  name: string;
  icon: string;
  specLabel: string;
  role: TankRole;
  tanked: string;
  swingShare: number;
  effectiveHealth: number;
  avoided: number;
  crushes: number;
  swings: number;
  /** Share of swings taken under Holy Shield / Shield Block (warriors, paladins). */
  coverage?: number;
  tps: number;
  opener: number;
  cooldowns: number;
  threatDrops: number;
  died: boolean;
}

export interface TankRaidSummary {
  report: string;
  bosses: { fight: number; name: string; durationSec: number; rows: TankRaidRow[] }[];
}
