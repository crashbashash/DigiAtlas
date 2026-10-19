import { expect, it } from 'vitest';
import { readGamecubeCard, readGamecubeGci } from './gamecube-save';
import { readPowerBoxes } from './power-save-file';
import type { Item, SaveStats } from './types';

const stats: SaveStats = {
  forms: [
    {
      species: 0,
      name: 'Agumon',
      model: 'p_agumon',
      wisdomInitial: 100,
      wisdomGrowth: 50,
      strengthInitial: 200,
      strengthGrowth: 100,
      speedInitial: 80,
      speedGrowth: 20,
    },
  ],
  wisdomBoards: [],
  strengthBoards: [],
  speedBoards: [],
};
const items = new Map<string, Item>([
  [
    'weapon:0',
    {
      category: 'weapon',
      id: 0,
      name: 'Sword',
      description: null,
      skillType: 'Slash',
      stats: { strength: 30, speed: 2, wisdom: 5, hitRate: 78 },
    },
  ],
]);

function saveFixture() {
  const save = new ArrayBuffer(81920);
  const data = new DataView(save);
  data.setUint32(4, 4);
  data.setUint8(8, 1);
  data.setUint16(0x30, 0xffff);
  for (const [i, c] of [...'ICE'].entries()) data.setUint16(0x32 + i * 2, c.charCodeAt(0));
  data.setUint8(0x76c, 1);
  data.setUint32(0x77c, 10);
  data.setUint32(0x7fc + 4, 1500);
  data.setUint32(0x7fc + 8 * 4, 1000);
  for (const [stat, value] of [
    [2, 50],
    [4, 20],
    [6, 10],
  ])
    data.setUint32(0xa3c + stat * 4, value);
  for (let at = 0x2e4; at <= 0x31c; at += 4) data.setInt32(at, -1);
  data.setInt32(0x2e4, 0);
  data.setUint32(0x6c, 16 << 20);
  let sum = 0;
  for (let at = 4; at < 0xa000; at += 4) sum = (sum + data.getInt32(at)) | 0;
  data.setInt32(0, sum);
  new Uint8Array(save).copyWithin(0xa000, 0, 0xa000);
  return save;
}
function gciFixture(code = 'GDJEB2') {
  const bytes = new Uint8Array(0x16040);
  bytes.set(new TextEncoder().encode(code));
  bytes.set(new TextEncoder().encode('NDMWSaveData'), 8);
  new DataView(bytes.buffer).setUint16(0x38, 11);
  bytes.set(new Uint8Array(saveFixture()), 0x2040);
  return bytes.buffer;
}
function sealMetadata(buffer: ArrayBuffer, start: number, end: number, stored: number) {
  const data = new DataView(buffer);
  let sum = 0,
    inverse = 0;
  for (let at = start; at < end; at += 2) {
    const value = data.getUint16(at);
    sum = (sum + value) & 0xffff;
    inverse = (inverse + (value ^ 0xffff)) & 0xffff;
  }
  data.setUint16(stored, sum === 0xffff ? 0 : sum);
  data.setUint16(stored + 2, inverse === 0xffff ? 0 : inverse);
}
function cardFixture() {
  const bytes = new Uint8Array(0x80000).fill(255);
  const data = new DataView(bytes.buffer);
  bytes.fill(0, 0, 0x2000);
  data.setUint16(0x22, 4);
  sealMetadata(bytes.buffer, 0, 0x1fc, 0x1fc);
  const file = new Uint8Array(gciFixture());
  const chain = Array.from({ length: 11 }, (_, i) => 5 + i * 2);
  for (const block of [1, 2]) {
    const base = block * 0x2000;
    bytes.set(file.subarray(0, 0x40), base);
    data.setUint16(base + 0x36, chain[0]);
    data.setUint16(base + 0x1ffa, 1);
    sealMetadata(bytes.buffer, base, base + 0x1ffc, base + 0x1ffc);
  }
  for (const block of [3, 4]) {
    const base = block * 0x2000;
    bytes.fill(0, base, base + 0x2000);
    data.setUint16(base + 4, 1);
    data.setUint16(base + 6, 64 - 5 - 11);
    chain.forEach((b, i) => data.setUint16(base + 0xa + (b - 5) * 2, chain[i + 1] ?? 0xffff));
    sealMetadata(bytes.buffer, base + 4, base + 0x2000, base);
  }
  chain.forEach((b, i) =>
    bytes.set(file.subarray(0x40 + i * 0x2000, 0x40 + (i + 1) * 0x2000), b * 0x2000),
  );
  return bytes.buffer;
}

it('reads big-endian character stats from GCI, raw saves and fragmented full cards without editing them', () => {
  for (const buffer of [gciFixture(), gciFixture('GDJJB2'), saveFixture(), cardFixture()]) {
    const before = new Uint8Array(buffer).slice();
    const boxes = readPowerBoxes(buffer, stats, items);
    expect(boxes[0].digimon[0]).toMatchObject({
      player: 'ICE',
      level: 10,
      strength: 381,
      speed: 109,
      wisdom: 167,
      force: 1000,
      xdata: { strength: 50, speed: 10, wisdom: 20 },
    });
    expect(new Uint8Array(buffer)).toEqual(before);
  }
});
it('rejects damaged GCI wrappers and game checksums', () => {
  expect(() => readGamecubeGci(gciFixture().slice(0, -1))).toThrow('intact');
  const gci = gciFixture();
  new DataView(gci).setUint16(0x38, 10);
  expect(() => readGamecubeGci(gci)).toThrow('intact');
  const corrupt = gciFixture();
  new Uint8Array(corrupt)[0x2040 + 0x100] ^= 1;
  expect(() => readPowerBoxes(corrupt, stats, items)).toThrow('checksum');
});
it('recovers one damaged directory copy and refuses multiple damaged copies or allocation cycles', () => {
  const card = cardFixture();
  new Uint8Array(card)[0x2000 + 0x100] ^= 1;
  expect(readGamecubeCard(card)).toHaveLength(1);
  new Uint8Array(card)[0x4000 + 0x100] ^= 1;
  expect(() => readGamecubeCard(card)).toThrow('corrupt');
  const cycle = cardFixture();
  new DataView(cycle).setUint16(3 * 0x2000 + 0xa, 5);
  sealMetadata(cycle, 3 * 0x2000 + 4, 4 * 0x2000, 3 * 0x2000);
  expect(() => readGamecubeCard(cycle)).toThrow('loops');
});
