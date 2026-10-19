import { describe, expect, it } from 'vitest';
import { characterStats } from './character-stats';
import { readPowerSave } from './power-save';
import { equipmentStats } from './weapon-equipment';
import { readPowerBoxes } from './power-save-file';
import type { Item, SaveStats } from './types';

const stats: SaveStats = {
  forms: [
    { species: 3, name: 'Dorumon', model: 'p_dorumon', wisdomInitial: 100, wisdomGrowth: 50 },
  ],
  wisdomBoards: [2],
};
function fixture(): ArrayBuffer {
  const buffer = new ArrayBuffer(81920);
  const d = new DataView(buffer);
  d.setInt32(4, 4, true);
  for (const slot of [0, 2]) {
    const b = slot * 0x2000;
    d.setUint8(b + 8, 1);
    d.setUint8(b + 0x76c + 3, 1);
    d.setInt32(b + 0x77c + 3 * 4, 10, true);
    d.setInt32(b + 0x7fc + (3 * 9 + 8) * 4, 1500 + slot, true);
    d.setInt32(b + 0xa3c + (3 * 11 + 4) * 4, 20, true);
    for (let o = 0x2e4; o <= 0x31c; o += 4) d.setInt32(b + o, -1, true);
    d.setInt32(b + 0x31c, 0, true);
    d.setUint32(b + 0x6c, 2 | (2 << 12) | (10 << 20), true);
  }
  return seal(buffer);
}
function seal(buffer: ArrayBuffer): ArrayBuffer {
  const d = new DataView(buffer);
  let sum = 0;
  for (let o = 4; o < 0xa000; o += 4) sum = (sum + d.getInt32(o, true)) | 0;
  d.setInt32(0, sum, true);
  new Uint8Array(buffer).copyWithin(0xa000, 0, 0xa000);
  return buffer;
}
const items = new Map<string, Item>([
  [
    'armor2:2',
    { category: 'armor2', id: 2, name: 'Wisdom board', description: null, stats: { wisdom: 30 } },
  ],
]);

describe('power calculator save reader', () => {
  it('groups Digimon by save box without mixing character records', () => {
    const boxes = readPowerBoxes(fixture(), stats, items);
    expect(boxes.map((b) => [b.id, b.label, b.digimon.map((d) => d.force)])).toEqual([
      ['0:0', 'Box 1 · Character 1', [1500]],
      ['0:2', 'Box 3 · Character 3', [1502]],
    ]);
  });
  it('reads every used character and unlocked species, applying growth, upgrades and board revision', () => {
    const buffer = fixture();
    const before = new Uint8Array(buffer).slice();
    const result = readPowerSave(buffer, stats, items);
    expect(result.map((s) => [s.slot, s.level, s.force, s.wisdom])).toEqual([
      [0, 10, 1500, 202],
      [2, 10, 1502, 202],
    ]);
    for (const saved of result) {
      const derived = characterStats(
        stats.forms[0],
        saved.level,
        saved.xdata,
        saved.equipment,
        items,
        stats,
      );
      expect(derived.wisdom).toBe(saved.wisdom);
      expect(saved.xdata.wisdom).toBe(20);
    }
    expect(new Uint8Array(buffer)).toEqual(before);
  });
  it('only adds board revision for a matching main attribute', () => {
    expect(readPowerSave(fixture(), { ...stats, wisdomBoards: [] }, items)[0].wisdom).toBe(192);
  });
  it('rebuilds weapon stats from the active weapon and equipped power chips, excluding armor-only bonuses and spare weapons', () => {
    const buffer = fixture();
    const view = new DataView(buffer);
    const fullStats: SaveStats = {
      ...stats,
      strengthBoards: [],
      forms: stats.forms.map((f) => ({ ...f, strengthInitial: 100, strengthGrowth: 50 })),
    };
    const gear = new Map(items);
    const add = (
      category: string,
      id: number,
      strength: number,
      critRate = 0,
      element?: Item['element'],
      skillType?: string,
    ) =>
      gear.set(`${category}:${id}`, {
        category,
        id,
        name: 'Equipment fixture',
        description: null,
        stats: { strength, critRate },
        element,
        skillType,
      });
    add('weapon', 0, 20, 10, undefined, 'Bash');
    add('abChip', 0, 30, 4, 'fire');
    add('armor1', 0, 900, 200);
    add('abChip', 1, 800, 100, 'dark');
    add('abChip', 2, 0, 0, 'ice');
    add('weapon', 1, 999, 200, undefined, 'Shot');
    gear.set('armor2:2', { ...items.get('armor2:2')!, stats: { strength: 40, wisdom: 30 } });
    const put = (offset: number, value: number) => view.setUint32(offset, value, true);
    put(0xa3c + (3 * 11 + 2) * 4, 10);
    put(0x7fc + (3 * 9 + 3) * 4, 1200);
    put(0x70, 0 | (7 << 20)); // Active weapon, folder index 1.
    put(0x74, 0 | (3 << 12));
    put(0x78, 0 | (1 << 12));
    put(0x7c, 1 | (3 << 12));
    put(0x80, 2 | (3 << 12));
    put(0x84, 1); // Spare weapon in another equipped socket.
    put(0x2e4, 1);
    put(0x2e8, 6);
    put(0x2f0, 2);
    put(0x2f4, 5);
    put(0x304, 3);
    put(0x308, 4);
    const read = (s = fullStats) => readPowerSave(seal(buffer), s, gear)[0];
    expect(read().strength).toBe(249); // 100 + floor(50*85/100) + 10 + 20 + 7 + 30 + 40.
    expect(read().skills[3]).toBe(1200);
    expect(read().weaponSkill).toBe(3);
    expect(read().weaponKey).toBe('weapon:0');
    expect(read().critChance).toBe(7);
    expect(read().element).toBe('fire');
    const loaded = read();
    expect(loaded.baseStrength).toBe(152);
    expect(loaded.equipment.core).toEqual({ key: 'armor1:0', revision: 0 });
    expect(loaded.equipment.subBoard).toEqual({ key: 'armor2:2', revision: 10 });
    expect(loaded.equipment.weaponChips.slice(0, 2)).toEqual([
      { key: 'abChip:0', revision: 0 },
      { key: 'abChip:2', revision: 0 },
    ]);
    expect(loaded.equipment.boardChips).toEqual([
      { key: 'abChip:1', revision: 0 },
      null,
      null,
      null,
      null,
    ]);
    expect(
      equipmentStats(152, { ...loaded.equipment, core: null, boardChips: [] }, gear, fullStats),
    ).toEqual(equipmentStats(152, loaded.equipment, gear, fullStats));

    expect(equipmentStats(loaded.baseStrength!, loaded.equipment, gear, fullStats)).toMatchObject({
      strength: loaded.strength,
      critChance: loaded.critChance,
      element: loaded.element,
      weaponSkill: loaded.weaponSkill,
    });
    expect(
      equipmentStats(152, loaded.equipment, gear, { ...fullStats, strengthBoards: [2] }).strength,
    ).toBe(259);
    const swapped = { ...loaded.equipment, weapon: { key: 'weapon:1', revision: 4 } };
    expect(equipmentStats(152, swapped, gear, fullStats)).toMatchObject({
      strength: 1225,
      critChance: 100,
      element: 'fire',
      weaponSkill: 4,
    });
    expect(equipmentStats(9999, swapped, gear, fullStats).strength).toBe(9999);
    expect(
      equipmentStats(
        152,
        { weapon: null, core: null, subBoard: null, weaponChips: [], boardChips: [] },
        gear,
        fullStats,
      ),
    ).toMatchObject({
      strength: 152,
      critChance: 0.5,
      element: 'none',
      weaponSkill: 0,
    });

    const speedyStats: SaveStats = {
      ...fullStats,
      speedBoards: [2],
      forms: fullStats.forms.map((f) => ({ ...f, speedInitial: 100, speedGrowth: 50 })),
    };
    put(0xa3c + (3 * 11 + 6) * 4, 10);
    for (const [key, speed] of [
      ['weapon:0', 5],
      ['abChip:0', 6],
      ['armor1:0', 7],
      ['abChip:1', 8],
      ['armor2:2', 9],
    ] as const) {
      const item = gear.get(key)!;
      gear.set(key, { ...item, stats: { ...item.stats, speed } });
    }
    const speedy = read(speedyStats);
    expect(speedy.baseSpeed).toBe(152);
    expect(speedy.speed).toBe(197);
    expect(equipmentStats(152, speedy.equipment, gear, speedyStats, 152).speed).toBe(197);
    expect(
      equipmentStats(152, speedy.equipment, gear, { ...speedyStats, speedBoards: [] }, 152).speed,
    ).toBe(187);
    expect(
      equipmentStats(
        152,
        { ...speedy.equipment, boardChips: [], core: null },
        gear,
        speedyStats,
        152,
      ).speed,
    ).toBe(182);
    expect(equipmentStats(152, speedy.equipment, gear, speedyStats, 9999).speed).toBe(9999);

    expect(read({ ...fullStats, wisdomBoards: [], strengthBoards: [2] }).strength).toBe(259);
    put(0x2f0, 0xffffffff);
    expect(read().strength).toBe(219);
    expect(read().critChance).toBe(5);
    expect(read().element).toBe('ice');
    put(0x2f4, 0xffffffff);
    put(0x2e4, 0xffffffff);
    expect(read().strength).toBe(192);
    expect(read().critChance).toBe(0.5);
    expect(read().element).toBe('none');
    expect(read().weaponKey).toBeNull();
  });
  it('includes both Wisdom plug increments from the saved permanent-upgrade counter', () => {
    // Retail insItem rows 12/13 add 1/2 to UPCNT[4]; CURRENT2BASE saves that
    // as BASE_UPCNT[species * 11 + 4], shared with X-Data Wisdom upgrades.
    for (const increment of [1, 2]) {
      const buffer = fixture();
      const view = new DataView(buffer);
      const offset = 0xa3c + (3 * 11 + 4) * 4;
      view.setInt32(offset, view.getInt32(offset, true) + increment, true);
      const result = readPowerSave(seal(buffer), stats, items);
      expect(result[0].wisdom).toBe(202 + increment);
      expect(result[1].wisdom).toBe(202);
    }
  });
  it('counts chips in equipped pockets and ignores loose inventory and bank items', () => {
    const buffer = fixture();
    const view = new DataView(buffer);
    const gear = new Map(items);
    for (const [id, wisdom] of [
      [0, 60],
      [1, 90],
      [2, 700],
    ]) {
      gear.set(`abChip:${id}`, {
        category: 'abChip',
        id,
        name: 'Test chip',
        description: null,
        stats: { wisdom },
      });
      view.setUint32(0x70 + id * 4, id | (3 << 12) | (id < 2 ? 0x400 : 0), true);
    }
    view.setUint32(0x160, 2 | (3 << 12), true); // Stored in bank, also excluded.
    view.setInt32(0x2f0, 1, true); // Equipped weapon-pocket chip.
    view.setInt32(0x308, 2, true); // Equipped armor-pocket chip.
    const wisdom = () => readPowerSave(seal(buffer), stats, gear)[0].wisdom;
    expect(wisdom()).toBe(202 + 60 + 90);
    view.setInt32(0x2f0, -1, true);
    expect(wisdom()).toBe(202 + 90);
    view.setInt32(0x308, -1, true);
    expect(wisdom()).toBe(202);
    view.setInt32(0x31c, -1, true);
    expect(wisdom()).toBe(162);
  });
  it('rejects card images, corrupt checksums, mismatched backups and invalid equipment', () => {
    expect(() => readPowerSave(new ArrayBuffer(10), stats, items)).toThrow('80 KB');
    const corrupt = fixture();
    new Uint8Array(corrupt)[100] ^= 1;
    expect(() => readPowerSave(corrupt, stats, items)).toThrow('checksum');
    const mismatch = fixture();
    const view = new DataView(mismatch);
    view.setInt32(0xa000 + 0x64, 1, true);
    view.setInt32(0xa000, view.getInt32(0xa000, true) + 1, true);
    expect(() => readPowerSave(mismatch, stats, items)).toThrow('backup differs');
    const bad = fixture();
    new DataView(bad).setInt32(0x31c, 36, true);
    seal(bad);
    expect(() => readPowerSave(bad, stats, items)).toThrow('reference');
  });
});
