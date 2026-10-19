import type { XDataPower } from './character-stats';
import type { AttackElement, Item, SaveStats } from './types';
import { emptyEquipment, equipmentStats, type WeaponEquipment } from './weapon-equipment';

export interface SavedDigimon {
  slot: number;
  player: string;
  species: number;
  name: string;
  level: number;
  force: number;
  xdata: XDataPower;
  wisdom: number;
  strength?: number;
  baseStrength?: number;
  speed?: number;
  baseSpeed?: number;
  hitRate: number;
  equipment: WeaponEquipment;
  skills: number[];
  weaponSkill: number;
  weaponKey: string | null;
  critChance: number;
  element: AttackElement;
}

// PS2 and GameCube deliver structure: four character records, two mirrored checksum blocks.
// See the decomp's port/docs/save-image.md and port/src/playerstats.c.
export function readPowerSave(
  buffer: ArrayBuffer,
  stats: SaveStats,
  items: Map<string, Item>,
): SavedDigimon[] {
  if (buffer.byteLength !== 81920) {
    throw new Error('The save data must be an 80 KB Digimon World 4 save data.');
  }
  const data = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const littleEndian = data.getUint32(4, true) === 4;
  const word = (offset: number) => data.getInt32(offset, littleEndian);
  for (const block of [0, 0xa000]) {
    if (word(block + 4) !== 4)
      throw new Error('Unsupported save version. Choose a Digimon World 4 PS2 or GameCube save.');
    let sum = 0;
    for (let o = block + 4; o < block + 0xa000; o += 4) sum = (sum + word(o)) | 0;
    if (sum !== word(block)) throw new Error('The save checksum is invalid.');
  }
  for (let o = 0; o < 0xa000; o++) {
    if (bytes[o] !== bytes[o + 0xa000])
      throw new Error('The save’s backup differs from its primary data.');
  }
  const limits = [5, 10, 20, 30, 50, 70, 110, 150, 230, 999];
  const origins = [1, 5, 10, 20, 30, 50, 70, 110, 150, 230];
  const offsets = [0, 40, 85, 165, 235, 355, 455, 615, 735, 895];
  const rates = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const result: SavedDigimon[] = [];
  for (let slot = 0; slot < 4; slot++) {
    const b = slot * 0x2000;
    if (!bytes[b + 8]) continue;
    let player = '';
    if (data.getUint16(b + 0x30, littleEndian) === 0xffff) {
      for (let o = 0x32; o < 0x42; o += 2) {
        const c = data.getUint16(b + o, littleEndian);
        if (!c || c === 0xffff) break;
        player += String.fromCharCode(c);
      }
    } else {
      player = new TextDecoder('shift-jis').decode(bytes.slice(b + 0x30, b + 0x40)).split('\0')[0];
    }
    player = player.normalize('NFKC').trim() || `Character ${slot + 1}`;
    const loadout = emptyEquipment();
    let equipment = 0;
    let strengthBonus = 0;
    let critRate = 0;
    let weaponSkill = 0;
    let weaponKey: string | null = null;
    let element: AttackElement = 'none';
    // Wisdom: first weapon/core/board, all equipped ability chips; board revision only
    // when its SHUSEINOURYOKU is KASHIKOSA. Other revisions do not add Wisdom.
    for (const [offset, count, kind] of [
      [0x2e4, 1, 0],
      [0x2f0, 5, 3],
      [0x304, 1, 1],
      [0x308, 5, 3],
      [0x31c, 1, 2],
    ]) {
      for (let i = 0; i < count; i++) {
        const ref = word(b + offset + i * 4);
        if (ref === -1) continue;
        if (ref < 0 || ref >= 36) throw new Error('Invalid equipment reference in the save.');
        const id = data.getUint32(b + 0x6c + ref * 4, littleEndian);
        const category = ['weapon', 'armor1', 'armor2', 'abChip'][kind];
        if (((id >>> 12) & 15) !== kind) throw new Error('Invalid equipped item type in the save.');
        const item = items.get(`${category}:${id & 1023}`);
        if (!item) throw new Error('An equipped item is missing from the imported disc data.');
        equipment = (equipment + (item.stats?.wisdom ?? 0)) | 0;
        const revision = (id >>> 20) & 2047;
        const equipped = { key: `${category}:${id & 1023}`, revision };
        if (offset === 0x2e4) loadout.weapon = equipped;
        if (offset === 0x304) loadout.core = equipped;
        if (offset === 0x308) loadout.boardChips[i] = equipped;
        if (offset === 0x31c) loadout.subBoard = equipped;
        if (offset === 0x2f0) loadout.weaponChips[i] = equipped;
        if (offset === 0x2e4 || offset === 0x2f0 || offset === 0x31c) {
          strengthBonus = (strengthBonus + (item.stats?.strength ?? 0)) | 0;
          if (offset === 0x2e4 || (offset === 0x31c && stats.strengthBoards?.includes(id & 1023)))
            strengthBonus = (strengthBonus + revision) | 0;
        }
        if (offset === 0x2e4 || offset === 0x2f0)
          critRate = (critRate + (item.stats?.critRate ?? 0)) | 0;
        if (offset === 0x2e4) {
          weaponKey = `${category}:${id & 1023}`;
          const slot = ['Blunt', 'Slash', 'Stab', 'Bash', 'Shot', 'Crush'].indexOf(
            item.skillType ?? 'Blunt',
          );
          if (slot < 0) throw new Error('Unsupported weapon skill in the imported item data.');
          weaponSkill = slot;
        }
        if (offset === 0x2f0 && element === 'none' && item.element) element = item.element;
        if (kind === 2 && stats.wisdomBoards.includes(id & 1023))
          equipment = (equipment + ((id >>> 20) & 2047)) | 0;
      }
    }
    for (const form of stats.forms) {
      const species = form.species;
      if (!bytes[b + 0x76c + species]) continue;
      const level = word(b + 0x77c + species * 4);
      if (level < 1 || level > 999) throw new Error('A saved Digimon has an unsupported level.');
      const seg = limits.findIndex((limit) => level <= limit);
      const factor = offsets[seg] + rates[seg] * (level - origins[seg]);
      const upgrades = word(b + 0xa3c + (species * 11 + 4) * 4);
      const growth = Math.trunc(Math.imul(form.wisdomGrowth, factor) / 100);
      const base = Math.min(9999, (upgrades + form.wisdomInitial + growth) | 0);
      let strength: number | undefined;
      let baseStrength: number | undefined;
      if (
        form.strengthInitial !== undefined &&
        form.strengthGrowth !== undefined &&
        stats.strengthBoards
      ) {
        const permanent = word(b + 0xa3c + (species * 11 + 2) * 4);
        const growth = Math.trunc(Math.imul(form.strengthGrowth, factor) / 100);
        const base = Math.min(9999, (permanent + form.strengthInitial + growth) | 0);
        baseStrength = base;
        strength = Math.max(1, Math.min(9999, (base + strengthBonus) | 0));
      }
      let baseSpeed: number | undefined;
      if (form.speedInitial !== undefined && form.speedGrowth !== undefined && stats.speedBoards) {
        const permanent = word(b + 0xa3c + (species * 11 + 6) * 4);
        baseSpeed = Math.min(
          9999,
          (permanent + form.speedInitial + Math.trunc(Math.imul(form.speedGrowth, factor) / 100)) |
            0,
        );
      }
      const attackStats = equipmentStats(baseStrength ?? 0, loadout, items, stats, baseSpeed);
      const skills = Array.from({ length: 9 }, (_, i) => word(b + 0x7fc + (species * 9 + i) * 4));
      result.push({
        slot,
        player,
        species,
        name: form.name,
        level,
        xdata: {
          strength: word(b + 0xa3c + (species * 11 + 2) * 4),
          speed: word(b + 0xa3c + (species * 11 + 6) * 4),
          wisdom: upgrades,
        },
        force: word(b + 0x7fc + (species * 9 + 8) * 4),
        wisdom: Math.max(1, Math.min(9999, (base + equipment) | 0)),
        strength,
        baseStrength,
        baseSpeed,
        speed: baseSpeed === undefined ? undefined : attackStats.speed,
        hitRate: attackStats.hitRate,
        equipment: loadout,
        skills,
        weaponSkill,
        weaponKey,
        element,
        critChance: Math.min(100, Math.max(1, critRate) / 2),
      });
    }
  }
  if (!result.length) throw new Error('No unlocked Digimon were found in this save.');
  return result;
}
