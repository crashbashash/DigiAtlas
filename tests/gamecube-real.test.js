import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readPowerBoxes } from '../src/data/power-save-file';

it.skipIf(!process.env.DIGIATLAS_GC_SAVE || !process.env.DIGIATLAS_TEST_ITEMS)('reads a real GameCube GCI or card without changing it', () => {
  const path = process.env.DIGIATLAS_GC_SAVE;
  const raw = readFileSync(path);
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const data = JSON.parse(readFileSync(process.env.DIGIATLAS_TEST_ITEMS, 'utf8'));
  const items = new Map(data.items.map((i) => [`${i.category}:${i.id}`, i]));
  const boxes = readPowerBoxes(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), data.saveStats, items);
  expect(boxes.length).toBeGreaterThan(0);
  expect(boxes.every((b) => b.digimon.length > 0)).toBe(true);
  expect(hash(readFileSync(path))).toBe(hash(raw));
});
