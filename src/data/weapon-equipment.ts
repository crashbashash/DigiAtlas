import type { Item, SaveStats } from './types';
import { WEAPON_SKILLS } from './weapon-damage';

export interface EquippedItem {
  key: string;
  revision: number;
}
export interface WeaponEquipment {
  weapon: EquippedItem | null;
  core: EquippedItem | null;
  subBoard: EquippedItem | null;
  weaponChips: (EquippedItem | null)[];
  boardChips: (EquippedItem | null)[];
}
export const emptyEquipment = (): WeaponEquipment => ({
  weapon: null,
  core: null,
  subBoard: null,
  weaponChips: Array.from({ length: 5 }, () => null),
  boardChips: Array.from({ length: 5 }, () => null),
});

export function equipmentStats(
  baseStrength: number,
  equipment: WeaponEquipment,
  items: Map<string, Item>,
  stats: SaveStats | undefined,
  baseSpeed = 0,
) {
  const weapon = equipment.weapon && items.get(equipment.weapon.key);
  const board = equipment.subBoard && items.get(equipment.subBoard.key);
  // Retail assigns attack bonuses to weapon pockets and the sub board.
  // Preserve core/main-pocket slots in the setup without counting their attack fields.
  const chips = equipment.weaponChips.map((c) => c && items.get(c.key));
  let strength = baseStrength + (weapon?.stats?.strength ?? 0) + (equipment.weapon?.revision ?? 0);
  strength += board?.stats?.strength ?? 0;
  if (board && stats?.strengthBoards?.includes(board.id))
    strength += equipment.subBoard?.revision ?? 0;
  for (const chip of chips) strength += chip?.stats?.strength ?? 0;
  const critRate = chips.reduce(
    (n, c) => n + (c?.stats?.critRate ?? 0),
    weapon?.stats?.critRate ?? 0,
  );
  let speed = baseSpeed;
  for (const equipped of [
    equipment.weapon,
    ...equipment.weaponChips,
    equipment.core,
    ...equipment.boardChips,
    equipment.subBoard,
  ]) {
    if (!equipped) continue;
    const item = items.get(equipped.key);
    speed += item?.stats?.speed ?? 0;
    if (equipped === equipment.subBoard && item && stats?.speedBoards?.includes(item.id))
      speed += equipped.revision;
  }
  return {
    speed: Math.max(1, Math.min(9999, speed)),
    hitRate: weapon?.stats?.hitRate ?? 0,
    strength: Math.max(1, Math.min(9999, strength)),
    critChance: Math.min(100, Math.max(1, critRate) / 2),
    weaponSkill: Math.max(
      0,
      WEAPON_SKILLS.findIndex((s) => s === (weapon?.skillType ?? 'Blunt')),
    ),
    element: chips.find((c) => c?.element)?.element ?? 'none',
  } as const;
}

// Retail item colour thresholds; docs/systems/items.md, rarity seed section.
export const EQUIPMENT_RARITIES = [
  { name: 'White', minimum: 0, color: '#c9d1d9' },
  { name: 'Blue', minimum: 1, color: '#4c8dff' },
  { name: 'Green', minimum: 16, color: '#3fb950' },
  { name: 'Yellow', minimum: 128, color: '#d6b400' },
  { name: 'Orange', minimum: 512, color: '#f0883e' },
  { name: 'Pink', minimum: 1024, color: '#db61a2' },
] as const;
export function equipmentRarity(revision: number) {
  return (
    [...EQUIPMENT_RARITIES].reverse().find((r) => revision >= r.minimum) ?? EQUIPMENT_RARITIES[0]
  );
}

/** Offer every identified chip that can occupy this socket, regardless of its stats. */
export function canEquipChip(
  item: Item,
  slot: 'weapon' | 'board',
  equipment: WeaponEquipment,
  index: number,
  items: Map<string, Item>,
): boolean {
  if (item.category !== 'abChip' || item.unidentified || item.name === 'Sold Out') return false;
  const description = item.description ?? '';
  if (slot === 'board') return !item.element && !description.includes('Equip with WU only');
  if (description.includes('Equip with AB only')) return false;
  if (
    item.element &&
    equipment.weaponChips.some((chip, i) => i !== index && chip && items.get(chip.key)?.element)
  )
    return false;
  return true;
}
