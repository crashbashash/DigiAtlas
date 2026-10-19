import { readMemoryCard } from './memory-card';
import { readPowerSave, type SavedDigimon } from './power-save';
import type { Item, SaveStats } from './types';

export interface SaveBox {
  id: string;
  label: string;
  digimon: SavedDigimon[];
}

export function readPowerBoxes(
  buffer: ArrayBuffer,
  stats: SaveStats,
  items: Map<string, Item>,
): SaveBox[] {
  const saves =
    buffer.byteLength === 81920 ? [{ name: 'Save', data: buffer }] : readMemoryCard(buffer);
  const boxes: SaveBox[] = [];
  saves.forEach((save, index) => {
    const digimon = readPowerSave(save.data, stats, items);
    for (const slot of [...new Set(digimon.map((d) => d.slot))]) {
      const characters = digimon.filter((d) => d.slot === slot);
      boxes.push({
        id: `${index}:${slot}`,
        label: `Box ${slot + 1} · ${characters[0].player}${saves.length > 1 ? ` · ${save.name}` : ''}`,
        digimon: characters,
      });
    }
  });
  return boxes;
}
