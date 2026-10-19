import { isGamecubeGci, isGamecubeCard, readGamecubeGci, readGamecubeCard } from './gamecube-save';
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
  const ps2Card = new TextDecoder()
    .decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 28)))
    .startsWith('Sony PS2 Memory Card Format ');
  if (buffer.byteLength !== 81920 && !isGamecubeGci(buffer) && !isGamecubeCard(buffer) && !ps2Card)
    throw new Error('Choose a PS2 save or memory card, or a GameCube GCI save or raw memory card.');
  const saves =
    buffer.byteLength === 81920
      ? [{ name: 'Save', data: buffer }]
      : isGamecubeGci(buffer)
        ? readGamecubeGci(buffer)
        : isGamecubeCard(buffer)
          ? readGamecubeCard(buffer)
          : readMemoryCard(buffer);
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
