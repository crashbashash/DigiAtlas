import type { Item, SaveStats } from './types';
import { equipmentStats, type WeaponEquipment } from './weapon-equipment';

export interface XDataPower {
  strength: number;
  speed: number;
  wisdom: number;
}

export function levelStat(initial: number, growth: number, level: number, power: number) {
  const limits = [5, 10, 20, 30, 50, 70, 110, 150, 230, 999];
  const origins = [1, 5, 10, 20, 30, 50, 70, 110, 150, 230];
  const offsets = [0, 40, 85, 165, 235, 355, 455, 615, 735, 895];
  const rates = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const segment = limits.findIndex((limit) => level <= limit);
  if (
    !Number.isInteger(level) ||
    level < 1 ||
    segment < 0 ||
    !Number.isInteger(power) ||
    power < 0 ||
    power > 9999 ||
    !Number.isFinite(initial) ||
    !Number.isFinite(growth)
  )
    return NaN;
  const factor = offsets[segment] + rates[segment] * (level - origins[segment]);
  return Math.min(9999, power + initial + Math.trunc(Math.imul(growth, factor) / 100));
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
