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
  counts: Record<string, number>;
  knownGaps: string[];
}

export type EnemyKind = 'enemy' | 'boss' | 'object';

export interface Enemy {
  row: number;
  name: string;
  kind: EnemyKind;
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
  resist: { fire: number; ice: number; thunder: number; dark: number; stun: number; poison: number };
  rates: { crit: number; paralysis: number };
  rarity: number;
}

export interface Item {
  category: string;
  id: number;
  name: string;
  description: string | null;
  skillType?: string;
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

export interface Stage {
  id: string;
  area: string | null;
  room: string | null;
  kind: StageKind;
  floor: string | null;
  variant: 'e' | 'h' | 'v' | null;
  banner: string | null;
  map: StageMap | null;
  difficulties: Partial<Record<Difficulty, { generators: Generator[] }>>;
}

export interface RawData {
  manifest: Manifest;
  enemies: { rows: Enemy[] };
  items: { items: Item[] };
  drops: { pools: Record<string, DropPool> };
  stages: { stages: Stage[] };
}
