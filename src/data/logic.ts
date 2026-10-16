import type { DropEntry, DropPool, Enemy, Generator, Item } from './types';

export const itemKey = (category: string, id: number): string => `${category}:${id}`;

export const CATEGORY_LABEL: Record<string, string> = {
  weapon: 'Weapon',
  armor1: 'Core',
  armor2: 'Board',
  abChip: 'Chip',
  conItem: 'Consumable',
  insItem: 'Mod item',
  impItem: 'Key item',
};
export const categoryLabel = (c: string): string => CATEGORY_LABEL[c] ?? c;

export const STAT_LABEL: Record<string, string> = {
  strength: 'Strength',
  defense: 'Defense',
  wisdom: 'Wisdom',
  spirit: 'Spirit',
  speed: 'Speed',
  maxHp: 'Max HP',
  maxMp: 'Max MP',
  resistFire: 'Fire resist',
  resistIce: 'Ice resist',
  resistThunder: 'Thunder resist',
  resistDark: 'Dark resist',
  resistStun: 'Stun resist',
  resistPoison: 'Poison resist',
  critRate: 'Crit rate',
  paralysisRate: 'Paralysis rate',
  hitRate: 'Hit rate',
  defenseRate: 'Defense rate',
  paralysisResist: 'Paralysis resist',
  poisonResist: 'Poison resist',
  bitRate: 'BIT rate',
  expRate: 'EXP rate',
  luckRate: 'Luck rate',
  hpDrain: 'HP drain',
  mpDrain: 'MP drain',
  provokeRate: 'Provoke rate',
  equipLevel: 'Equip level',
  requiredSkill: 'Required skill',
  buyPrice: 'Buy price',
  sellPrice: 'Sell price',
  restoreHp: 'Restores HP',
  restoreMp: 'Restores MP',
};
export const statLabel = (k: string): string => STAT_LABEL[k] ?? k;

export interface DropRow {
  key: string;
  category: string;
  id: number;
  rate: number; // out of 10000, merged across rank variants
  percent: number;
}

export interface DropTable {
  rows: DropRow[];
  /** Chance that nothing drops, as a percentage. */
  nothingPercent: number;
}

/**
 * One roll picks at most one entry (`RNG() % 10000`), so P(item) = rate / 10000 and
 * P(nothing) = 1 - sum / 10000. The same item can appear on several rows (one per rank); the game
 * does not read the rank, so the rows are one item with the summed chance.
 */
export function dropTable(pool: DropPool | null | undefined): DropTable {
  const merged = new Map<string, DropRow>();
  let total = 0;
  for (const e of pool?.entries ?? ([] as DropEntry[])) {
    total += e.rate;
    const key = itemKey(e.category, e.id);
    const row = merged.get(key);
    if (row) {
      row.rate += e.rate;
    } else {
      merged.set(key, { key, category: e.category, id: e.id, rate: e.rate, percent: 0 });
    }
  }
  const rows = [...merged.values()].filter((r) => r.rate > 0);
  for (const r of rows) r.percent = r.rate / 100;
  rows.sort((a, b) => b.rate - a.rate || a.key.localeCompare(b.key));
  return { rows, nothingPercent: Math.max(0, 10000 - total) / 100 };
}

export const formatPercent = (p: number): string =>
  p >= 10 ? p.toFixed(0) + '%' : p >= 1 ? p.toFixed(1).replace(/\.0$/, '') + '%' : p.toFixed(2).replace(/0$/, '') + '%';

export function startModeText(mode: string): string {
  switch (mode) {
    case 'direct':
      return 'Appears when a game script starts it (a trigger, a cutscene or the stage setup)';
    case 'radar':
      return 'Appears when you get close';
    case 'timer':
      return 'Appears after a delay';
    default:
      return mode || 'Unknown';
  }
}

export function fillModeText(mode: string): string {
  switch (mode) {
    case 'wipeout':
      return 'Next batch comes once all are defeated';
    case 'add':
      return 'Defeated enemies are replaced one by one';
    case 'timer':
      return 'Defeated enemies are replaced on a timer';
    default:
      return mode || 'Unknown';
  }
}

export interface EnemyGroup {
  row: number;
  enemy: Enemy | undefined;
  spawners: number;
  points: number;
  /** Total the spawners create (sum of their counts). */
  total: number;
  generators: number[]; // indices into the stage's generator list
}

/** Spawn generators grouped by what they spawn, in first-seen order. */
export function groupByEnemy(generators: Generator[], enemies: Map<number, Enemy>): EnemyGroup[] {
  const groups = new Map<number, EnemyGroup>();
  generators.forEach((g, i) => {
    let grp = groups.get(g.row);
    if (!grp) {
      grp = { row: g.row, enemy: enemies.get(g.row), spawners: 0, points: 0, total: 0, generators: [] };
      groups.set(g.row, grp);
    }
    grp.spawners += 1;
    grp.points += g.spawns.length;
    grp.total += g.count ?? 0;
    grp.generators.push(i);
  });
  return [...groups.values()];
}

export function itemMatchesQuery(item: Item, q: string): boolean {
  return item.name.toLowerCase().includes(q);
}
