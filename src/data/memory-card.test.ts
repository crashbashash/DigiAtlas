import { describe, expect, it } from 'vitest';
import { readMemoryCard } from './memory-card';

function fixture(ecc = false) {
  const card = new Uint8Array(256 * 1024);
  const view = new DataView(card.buffer);
  const put = (o: number, v: number) => view.setUint32(o, v, true);
  card.set(new TextEncoder().encode('Sony PS2 Memory Card Format '));
  view.setUint16(40, 512, true);
  view.setUint16(42, 2, true);
  put(48, 256);
  put(52, 8);
  put(56, 248);
  put(60, 0);
  put(80, 1);
  put(1024, 2); // double-indirect FAT
  function entry(
    relative: number,
    slot: number,
    name: string,
    mode: number,
    length: number,
    start: number,
  ) {
    const o = (8 + relative) * 1024 + slot * 512;
    put(o, mode);
    put(o + 4, length);
    put(o + 16, start);
    card.set(new TextEncoder().encode(name), o + 64);
  }
  function link(chain: number[]) {
    chain.forEach((c, i) =>
      put(2048 + c * 4, i === chain.length - 1 ? 0xffffffff : 0x80000000 + chain[i + 1]),
    );
  }
  entry(0, 0, '.', 0x8020, 4, 0);
  entry(0, 1, '..', 0x8020, 0, 0);
  entry(1, 0, 'BASLUS-20836savedata', 0x8020, 3, 2);
  entry(1, 1, 'BASLUS-20836savedata2', 0x8020, 3, 4);
  link([0, 1]);
  link([2, 3]);
  link([4, 5]);
  for (const [dir, first] of [
    [2, 10],
    [4, 100],
  ]) {
    entry(dir, 0, '.', 0x8020, 3, 0);
    entry(dir, 1, '..', 0x8020, 0, 0);
    entry(dir + 1, 0, 'BASLUS-20836savedata', 0x8010, 81920, first);
    const chain = Array.from({ length: 80 }, (_, i) => first + (i < 40 ? i * 2 : (i - 40) * 2 + 1));
    link(chain);
    chain.forEach((c, i) => card.fill((i + dir) & 255, (8 + c) * 1024, (9 + c) * 1024));
  }
  if (!ecc) return card.buffer;
  const raw = new Uint8Array(256 * 2 * 528).fill(255);
  for (let page = 0; page < 512; page++)
    raw.set(card.subarray(page * 512, (page + 1) * 512), page * 528);
  return raw.buffer;
}

describe('PS2 memory-card reader', () => {
  for (const ecc of [false, true]) {
    it(`reads multiple saves through fragmented FAT chains (${ecc ? 'ECC' : 'flat'})`, () => {
      const card = fixture(ecc);
      const before = new Uint8Array(card).slice();
      const saves = readMemoryCard(card);
      expect(saves.map((s) => s.name)).toEqual(['BASLUS-20836savedata', 'BASLUS-20836savedata2']);
      expect(saves[0].data.byteLength).toBe(81920);
      const payload = new Uint8Array(saves[0].data);
      expect([payload[0], payload[1024], payload[79 * 1024]]).toEqual([2, 3, 81]);
      expect(new Uint8Array(card)).toEqual(before);
    });
  }
  it('refuses cycles, free clusters, truncation and invalid geometry', () => {
    const cycle = fixture();
    new DataView(cycle).setUint32(2048 + 10 * 4, 0x8000000a, true);
    expect(() => readMemoryCard(cycle)).toThrow('damaged');
    const free = fixture();
    new DataView(free).setUint32(2048 + 10 * 4, 0, true);
    expect(() => readMemoryCard(free)).toThrow('damaged');
    expect(() => readMemoryCard(fixture().slice(0, -1))).toThrow('damaged');
    const invalid = fixture();
    new DataView(invalid).setUint32(52, 999999, true);
    expect(() => readMemoryCard(invalid)).toThrow('damaged');
  });
  it('ignores deleted save directories and reports cards without a compatible save', () => {
    const card = fixture();
    const v = new DataView(card);
    v.setUint32(9 * 1024, 0x20, true);
    v.setUint32(9 * 1024 + 512, 0x20, true);
    expect(() => readMemoryCard(card)).toThrow('No USA');
    expect(() => readMemoryCard(new ArrayBuffer(100))).toThrow('Choose a PS2');
  });
});
