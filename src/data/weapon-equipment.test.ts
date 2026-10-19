import { expect, it } from 'vitest';
import { equipmentRarity } from './weapon-equipment';

it('maps exact saved equipment bonuses to retail rarity colour bands', () => {
  for (const [bonus, color] of [
    [0, 'White'],
    [1, 'Blue'],
    [15, 'Blue'],
    [16, 'Green'],
    [127, 'Green'],
    [128, 'Yellow'],
    [511, 'Yellow'],
    [512, 'Orange'],
    [1023, 'Orange'],
    [1024, 'Pink'],
    [2047, 'Pink'],
  ] as const) {
    expect(equipmentRarity(bonus).name).toBe(color);
  }
});

import { canEquipChip, emptyEquipment, equipmentStats } from './weapon-equipment';
import type { Item } from './types';

const chip = (id: number, element?: Item['element']): Item => ({
  category: 'abChip',
  id,
  name: `${element ?? 'Critical'} chip`,
  description: 'Equip with WU only',
  element,
  stats: element ? { strength: 30 } : { critRate: 20 },
});
it('allows one PWR element per weapon, including replacement in the existing socket', () => {
  const fire = chip(0, 'fire'),
    ice = chip(1, 'ice'),
    critical = chip(2);
  const items = new Map([
    ['abChip:0', fire],
    ['abChip:1', ice],
    ['abChip:2', critical],
  ]);
  const gear = emptyEquipment();
  expect(canEquipChip(fire, 'weapon', gear, 0, items)).toBe(true);
  gear.weaponChips[0] = { key: 'abChip:0', revision: 0 };
  expect(canEquipChip(ice, 'weapon', gear, 1, items)).toBe(false);
  expect(canEquipChip(fire, 'weapon', gear, 1, items)).toBe(false);
  expect(canEquipChip(ice, 'weapon', gear, 0, items)).toBe(true);
  expect(canEquipChip(critical, 'weapon', gear, 1, items)).toBe(true);
  expect(canEquipChip(fire, 'board', gear, 0, items)).toBe(false);
});
it('rejects armour-only chips in weapon pockets even if they have attack-related bonuses', () => {
  const resist: Item = {
    ...chip(3),
    name: 'Fire Resist ROM',
    description: 'Equip with AB only',
    element: undefined,
    stats: { resistFire: 30, strength: 90, critRate: 20, speed: 30 },
  };
  const gear = emptyEquipment(),
    items = new Map([['abChip:3', resist]]);
  expect(canEquipChip(resist, 'weapon', gear, 0, items)).toBe(false);
  expect(canEquipChip(resist, 'board', gear, 0, items)).toBe(true);
});
it('derives critical chance and element only from the current equipped weapon and its chips', () => {
  const weapon: Item = {
    category: 'weapon',
    id: 0,
    name: 'Sword',
    description: null,
    skillType: 'Slash',
    stats: { strength: 200, critRate: 5 },
  };
  const items = new Map([
    ['weapon:0', weapon],
    ['abChip:0', chip(0, 'fire')],
    ['abChip:1', chip(1, 'ice')],
    ['abChip:2', chip(2)],
  ]);
  const gear = emptyEquipment();
  gear.weapon = { key: 'weapon:0', revision: 0 };
  gear.weaponChips[0] = { key: 'abChip:0', revision: 0 };
  gear.weaponChips[1] = { key: 'abChip:2', revision: 0 };
  expect(equipmentStats(100, gear, items, undefined)).toMatchObject({
    strength: 330,
    critChance: 12.5,
    element: 'fire',
  });
  expect(equipmentStats(2000, gear, items, undefined, 1000)).toMatchObject({
    critChance: 12.5,
    element: 'fire',
  });
  gear.weaponChips[0] = { key: 'abChip:1', revision: 0 };
  gear.weaponChips[1] = null;
  expect(equipmentStats(100, gear, items, undefined)).toMatchObject({
    critChance: 2.5,
    element: 'ice',
  });
  gear.weaponChips[0] = null;
  expect(equipmentStats(100, gear, items, undefined)).toMatchObject({
    critChance: 2.5,
    element: 'none',
  });
});

it('offers compatible chips even when they do not affect calculator stats', () => {
  const gear = emptyEquipment();
  const utilityStats: Record<string, number>[] = [
    { maxHp: 100 },
    { maxMp: 30 },
    { defense: 20 },
    { spirit: 15 },
    { resistFire: 30 },
    {},
  ];
  for (const stats of utilityStats) {
    const item: Item = {
      category: 'abChip',
      id: 9,
      name: 'Utility chip',
      description: null,
      stats,
    };
    const items = new Map([['abChip:9', item]]);
    expect(canEquipChip(item, 'weapon', gear, 0, items)).toBe(true);
    expect(canEquipChip(item, 'board', gear, 0, items)).toBe(true);
    expect(
      canEquipChip({ ...item, description: 'Equip with AB only' }, 'weapon', gear, 0, items),
    ).toBe(false);
    expect(
      canEquipChip({ ...item, description: 'Equip with WU only' }, 'board', gear, 0, items),
    ).toBe(false);
  }
});
