import { describe, expect, it } from 'vitest';
import { equipmentRequirements, skillCap } from './calculator-shortcuts';
import { emptyEquipment } from './weapon-equipment';
import type { Item } from './types';

describe('trainable skill maximum', () => {
  it('matches the retail growth bands and their boundaries', () => {
    for (const [level, cap] of [
      [1, 30],
      [36, 1080],
      [37, 1100],
      [107, 2500],
      [108, 2510],
      [227, 3700],
      [228, 3708],
      [999, 9876],
    ]) {
      expect(skillCap(level)).toBe(cap);
    }
    for (const level of [0, 1000, 1.5, NaN, Infinity]) expect(skillCap(level)).toBeNull();
  });
});

describe('equipment requirements', () => {
  const items = new Map<string, Item>([
    [
      'weapon:0',
      {
        category: 'weapon',
        id: 0,
        name: 'Blade',
        description: null,
        skillType: 'Slash',
        stats: { requiredSkill: 300 },
      },
    ],
    [
      'armor1:0',
      { category: 'armor1', id: 0, name: 'Core', description: null, stats: { equipLevel: 37 } },
    ],
    [
      'armor2:0',
      { category: 'armor2', id: 0, name: 'Board', description: null, stats: { equipLevel: 113 } },
    ],
  ]);
  it('takes the highest level across slots while keeping weapon skill separate', () => {
    const gear = {
      ...emptyEquipment(),
      weapon: { key: 'weapon:0', revision: 1024 },
      core: { key: 'armor1:0', revision: 0 },
      subBoard: { key: 'armor2:0', revision: 0 },
    };
    expect(equipmentRequirements(gear, items)).toEqual({
      hasEquipment: true,
      level: 113,
      weaponSkill: 300,
      skillType: 'Slash',
    });
    expect(equipmentRequirements({ ...gear, subBoard: null }, items).level).toBe(37);
    expect(equipmentRequirements({ ...gear, core: null, subBoard: null }, items).level).toBe(1);
  });
  it('handles unequipped and zero-requirement unique weapons', () => {
    expect(equipmentRequirements(emptyEquipment(), items)).toMatchObject({
      hasEquipment: false,
      level: 1,
      weaponSkill: null,
    });
    const unique: Item = { category: 'weapon', id: 266, name: 'Unique', description: null };
    expect(
      equipmentRequirements(
        { ...emptyEquipment(), weapon: { key: 'weapon:266', revision: 0 } },
        new Map([['weapon:266', unique]]),
      ),
    ).toMatchObject({ hasEquipment: true, level: 1, weaponSkill: 0 });
  });
});
