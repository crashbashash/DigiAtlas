import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readMemoryCard } from '../src/data/memory-card';
import { readPowerBoxes } from '../src/data/power-save-file';

it.skipIf(!process.env.DIGIATLAS_PS2_CARD)('reads a real card without changing it', () => {
  const raw = readFileSync(process.env.DIGIATLAS_PS2_CARD);
  const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const saves = readMemoryCard(buffer);
  expect(saves.length).toBeGreaterThan(0);
  for (const save of saves) {
    const v = new DataView(save.data);
    for (const b of [0, 0xa000]) {
      expect(v.getInt32(b + 4, true)).toBe(4);
      let sum = 0;
      for (let o = b + 4; o < b + 0xa000; o += 4) sum = (sum + v.getInt32(o, true)) | 0;
      expect(v.getInt32(b, true)).toBe(sum);
    }
  }
  const hash = (data) => createHash('sha256').update(data).digest('hex');
  expect(hash(readFileSync(process.env.DIGIATLAS_PS2_CARD))).toBe(hash(raw));
  if (process.env.DIGIATLAS_TEST_ITEMS) {
    const data = JSON.parse(readFileSync(process.env.DIGIATLAS_TEST_ITEMS, 'utf8'));
    const items = new Map(data.items.map((i) => [`${i.category}:${i.id}`, i]));
    const boxes = readPowerBoxes(buffer, data.saveStats, items);
    expect(boxes.length).toBeGreaterThan(0);
    expect(
      boxes.every((b) => b.digimon.length > 0 && new Set(b.digimon.map((d) => d.slot)).size === 1),
    ).toBe(true);
  }
});
