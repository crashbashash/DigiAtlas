// Mirrors schema/v1 (see docs/schema.md).

export type Difficulty = 'normal' | 'hard' | 'veryhard';
export const DIFFICULTIES: Difficulty[] = ['normal', 'hard', 'veryhard'];
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  normal: 'Normal',
  hard: 'Hard',
  veryhard: 'Very Hard',
};

export type Vec3 = [number, number, number];

export interface Manifest {
  schemaVersion: number;
  platform: string;
  region: string;
  serial: string | null;
  framesPerSecond?: 50 | 60;
  counts: Record<string, number>;
  knownGaps: string[];
  mod?: {
    id: 'dw4-crown-mod';
    version: string;
    options: { fourPlayerSpawns: boolean; betterLoot: boolean; randomCrownColours: boolean };
  } | null;
}

export type EnemyKind = 'enemy' | 'boss' | 'object';

export interface Enemy {
  row: number;
  name: string;
  kind: EnemyKind;
  /** Tells apart rows that share a name, such as a boss's forms ("Form 1"). */
  form?: string;
  /** A boss's part or minion, shown with that boss (`partOf`) rather than as an enemy of its own. */
  role?: 'part';
  partOf?: string;
  model: string;
  hp: number;
  stats: {
    strength: number;
    defense: number;
    wisdom: number;
    spirit: number;
    speed: number;
    exp: number;
  };
  resist: {
    fire: number;
    ice: number;
    thunder: number;
    dark: number;
    stun: number;
    poison: number;
  };
  rates: { crit: number; paralysis: number };
  rarity: number;
  crownStyle?: 'random';
}

export type AttackElement = 'none' | 'fire' | 'ice' | 'thunder' | 'dark';

export interface Item {
  category: string;
  id: number;
  name: string;
  description: string | null;
  skillType?: string;
  /** Verified ordinary hit attempts per normal attack input. */
  normalHits?: number;
  element?: Exclude<AttackElement, 'none'>;
  unidentified?: true;
  stats?: Record<string, number>;
}

export interface DropEntry {
  category: string;
  id: number;
  rank: number;
  rate: number; // out of 10000
}

export interface DropPool {
  entries: DropEntry[];
  totalRate: number;
  difficulty?: Difficulty;
}

export interface ScriptRef {
  verb: string;
  when: string[];
}

/** What the stage's scripts do with a spawner. */
export interface ScriptInfo {
  status: 'referenced' | 'dynamic' | 'unknown' | 'none';
  refs?: ScriptRef[];
}

export interface PlayerSlot {
  count: number | null;
  maxCount: number | null;
  drops?: Record<string, string>;
  lastDrops?: Record<string, string>;
}

export interface Generator {
  name: string;
  row: number;
  count: number | null;
  maxCount: number | null;
  spawns: Vec3[];
  rotations: number[];
  startMode: string;
  fillMode: string;
  lua?: string;
  /** Radar spawners start once a player is within `radius` units of `center`. */
  trigger?: { center: Vec3; radius: number };
  drops?: Record<string, string>;
  lastDrops?: Record<string, string>;
  /** One entry per player count (index 0 = one player); absent when it makes no difference. */
  players?: PlayerSlot[];
  script?: ScriptInfo;
  /** The stage shows a boss health bar for this spawner's enemy. */
  bossHealthBar?: true;
}

export interface StageMap {
  image: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  width: number;
  height: number;
  pixelsPerUnit: number;
  coverage: number;
  fill: number;
}

export type StageKind = 'field' | 'dungeon' | 'boss' | 'hub' | 'system';

/** A dungeon's e/h/v copies are the ones the game enters on Normal, Hard and Very Hard. */
export type Variant = 'e' | 'h' | 'v';
export const VARIANT_DIFFICULTY: Record<Variant, Difficulty> = {
  e: 'normal',
  h: 'hard',
  v: 'veryhard',
};

export interface ItemRef {
  category: string;
  id: number;
}

/** A Digimon in a shop room who swaps one item for another. */
export interface Offer {
  give: ItemRef;
  get: ItemRef;
}

export interface Trader {
  trader: string;
  number: number | null;
  /** Where it stands, in the same world space as spawn points. */
  position: { x: number; y: number; z: number };
  /** Degrees about the vertical axis. */
  facing: number;
  /** What it swaps on each difficulty; a difficulty with no entry has no trades. */
  tables: Partial<Record<Difficulty, Offer[]>>;
}

export interface Stage {
  id: string;
  area: string | null;
  room: string | null;
  kind: StageKind;
  floor: string | null;
  variant: Variant | null;
  banner: string | null;
  map: StageMap | null;
  trades: Trader[];
  difficulties: Partial<Record<Difficulty, { generators: Generator[] }>>;
}

export type GearKind = 'weapon' | 'armor1' | 'armor2';

/** One thing the appraiser can turn an unidentified item into, with its weight out of 10000. */
export interface AppraisalResult {
  category: GearKind;
  id: number;
  rate: number;
}

export interface AppraisalTier {
  tier: number;
  minLevel: number;
  /** Highest player level the tier applies to; null for the last. */
  maxLevel: number | null;
  results: Record<GearKind, AppraisalResult[]>;
}

export interface Appraisal {
  cost: number;
  tiers: AppraisalTier[];
}

export interface RawData {
  manifest: Manifest;
  enemies: { rows: Enemy[] };
  items: {
    items: Item[];
    appraisal?: Appraisal;
    powerSpells?: PowerSpell[];
    mpTechs?: MpTech[];
    saveStats?: SaveStats;
  };
  drops: { pools: Record<string, DropPool> };
  stages: { stages: Stage[] };
}

export interface PowerSpell {
  kind: 'up' | 'down';
  grade: string;
  row: number;
  baseFrames: number;
}

export type MpTechKind =
  | 'fire'
  | 'ice'
  | 'bolt'
  | 'dark'
  | 'venom'
  | 'impact'
  | 'cutter'
  | 'bomb'
  | 'heal-light'
  | 'heal-aura'
  | 'raise'
  | 'cure-light'
  | 'cure-aura'
  | 'speed'
  | 'freeze'
  | 'resist'
  | 'power-up'
  | 'power-down'
  | 'sleep'
  | 'bind';
export interface MpTech {
  kind: MpTechKind;
  grade: string;
  row: number;
  skill: 'blast' | 'heal' | 'force';
  element: AttackElement | 'poison';
  mpCost: number;
  power: number;
  baseFrames: number;
  criticalRate: number;
  healBase?: number;
  revive?: { hp: number; experiencePercent: number };
  boosts: {
    maxHp: number;
    strength: number;
    defense: number;
    speed?: number;
    hitRate?: number;
    evasion?: number;
    fire?: number;
    ice?: number;
    thunder?: number;
    dark?: number;
  };
}

export interface SaveStats {
  forms: {
    species: number;
    name: string;
    model: string;
    wisdomInitial: number;
    wisdomGrowth: number;
    strengthInitial?: number;
    strengthGrowth?: number;
    speedInitial?: number;
    speedGrowth?: number;
  }[];
  wisdomBoards: number[];
  strengthBoards?: number[];
  speedBoards?: number[];
}
