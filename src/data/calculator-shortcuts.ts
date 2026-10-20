import type { Item } from './types';
import type { WeaponEquipment } from './weapon-equipment';

/** Retail P2E_SKILL_UP and skill display: USA PS2 0x3ff268 and 0x41f92c. */
export function skillCap(level: number): number | null {
  if (!Number.isInteger(level) || level < 1 || level > 999) return null;
  if (level <= 36) return 30 * level;
  if (level <= 107) return 360 + 20 * level;
  if (level <= 227) return 1430 + 10 * level;
  return 1884 + 8 * level;
}

export function equipmentRequirements(equipment: WeaponEquipment, items: Map<string, Item>) {
  const equipped = [
    equipment.weapon,
    equipment.core,
    equipment.subBoard,
    ...equipment.weaponChips,
    ...equipment.boardChips,
  ].filter((item) => item !== null);
  const weapon = equipment.weapon && items.get(equipment.weapon.key);
  return {
    hasEquipment: equipped.length > 0,
    level: Math.max(1, ...equipped.map((item) => items.get(item.key)?.stats?.equipLevel ?? 0)),
    weaponSkill: weapon ? Math.max(0, weapon.stats?.requiredSkill ?? 0) : null,
    skillType: weapon?.skillType ?? 'Blunt',
  };
}
