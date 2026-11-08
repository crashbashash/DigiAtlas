import type { Item, SaveStats } from './types';
import { equipmentStats, type WeaponEquipment } from './weapon-equipment';
import { levelGrowth } from './stat-growth';

export interface XDataPower {
  strength: number;
  speed: number;
  wisdom: number;
}

export function levelStat(initial: number, growth: number, level: number, power: number) {
  return levelGrowth(initial, growth, level, power, 'stat');
}

export function characterStats(
  form: SaveStats['forms'][number],
  level: number,
  power: XDataPower,
  equipment: WeaponEquipment,
  items: Map<string, Item>,
  stats: SaveStats,
) {
  const baseStrength = levelStat(
    form.strengthInitial ?? NaN,
    form.strengthGrowth ?? NaN,
    level,
    power.strength,
  );
  const baseSpeed = levelStat(
    form.speedInitial ?? NaN,
    form.speedGrowth ?? NaN,
    level,
    power.speed,
  );
  let wisdom = levelStat(form.wisdomInitial, form.wisdomGrowth, level, power.wisdom);
  for (const equipped of [
    equipment.weapon,
    ...equipment.weaponChips,
    equipment.core,
    ...equipment.boardChips,
    equipment.subBoard,
  ]) {
    if (!equipped) continue;
    const item = items.get(equipped.key);
    wisdom += item?.stats?.wisdom ?? 0;
    if (equipped === equipment.subBoard && item && stats.wisdomBoards.includes(item.id))
      wisdom += equipped.revision;
  }
  return {
    ...equipmentStats(baseStrength, equipment, items, stats, baseSpeed),
    baseStrength,
    baseSpeed,
    wisdom: Math.max(1, Math.min(9999, wisdom)),
  };
}
