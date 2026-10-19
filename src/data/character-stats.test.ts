import { expect, it } from 'vitest';
import { characterStats, levelStat } from './character-stats';
import { emptyEquipment } from './weapon-equipment';
import type { Item, SaveStats } from './types';

it('uses the retail growth curve at level boundaries', () => {
  for (const [level, factor] of [
    [1, 0],
    [5, 40],
    [6, 49],
    [10, 85],
    [20, 165],
    [30, 235],
    [50, 355],
    [70, 455],
    [110, 615],
    [150, 735],
    [230, 895],
    [999, 1664],
  ]) {
    expect(levelStat(100, 100, level, 20)).toBe(120 + factor);
  }
  expect(levelStat(100, 50, 10, 20)).toBe(162);
  expect(levelStat(100, 100, 999, 9999)).toBe(9999);
  for (const level of [0, 1000, 1.5, NaN]) expect(levelStat(100, 100, level, 0)).toBeNaN();
});

it('recalculates species, level, XData and equipment together', () => {
  const form = {
    species: 0,
    name: 'Agumon',
    model: '',
    wisdomInitial: 100,
    wisdomGrowth: 50,
    strengthInitial: 200,
    strengthGrowth: 100,
    speedInitial: 80,
    speedGrowth: 20,
  };
  const stats: SaveStats = {
    forms: [form],
    wisdomBoards: [1],
    strengthBoards: [],
    speedBoards: [],
  };
  const items = new Map<string, Item>([
    [
      'weapon:0',
      {
        id: 0,
        category: 'weapon',
        name: 'Sword',
        description: null,
        skillType: 'Slash',
        stats: { strength: 30, wisdom: 10, hitRate: 78 },
      },
    ],
    [
      'armor2:1',
      {
        id: 1,
        category: 'armor2',
        name: 'Board',
        description: null,
        stats: { wisdom: 20, speed: 5 },
      },
    ],
    [
      'abChip:0',
      {
        id: 0,
        category: 'abChip',
        name: 'Chip',
        description: null,
        stats: { wisdom: 10, speed: 2 },
      },
    ],
  ]);
  const gear = emptyEquipment();
  gear.weapon = { key: 'weapon:0', revision: 16 };
  gear.subBoard = { key: 'armor2:1', revision: 128 };
  gear.boardChips[0] = { key: 'abChip:0', revision: 0 };
  const power = { strength: 50, speed: 10, wisdom: 20 };
  const result = characterStats(form, 10, power, gear, items, stats);
  expect(result).toMatchObject({
    strength: 381,
    speed: 114,
    wisdom: 330,
    hitRate: 78,
    weaponSkill: 1,
  });
  expect(characterStats(form, 1, power, gear, items, stats).wisdom).toBe(288);
  expect(
    characterStats({ ...form, wisdomInitial: 150 }, 10, power, gear, items, stats).wisdom,
  ).toBe(380);
  expect(characterStats(form, 10, power, emptyEquipment(), items, stats).wisdom).toBe(162);
  expect(characterStats(form, 10, { ...power, wisdom: 40 }, gear, items, stats).wisdom).toBe(350);
});
