import type { CardSave } from './memory-card';

const BLOCK = 0x2000;
const SAVE_SIZE = 0x14000;
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes).split('\0')[0];
const fail = (message: string): never => {
  throw new Error(`GameCube memory card: ${message}.`);
};

function isSaveEntry(bytes: Uint8Array) {
  return (
    ['GDJEB2', 'GDJJB2'].includes(text(bytes.subarray(0, 6))) &&
    text(bytes.subarray(8, 0x28)) === 'NDMWSaveData'
  );
}

export function isGamecubeGci(buffer: ArrayBuffer): boolean {
  return buffer.byteLength >= 0x40 && isSaveEntry(new Uint8Array(buffer, 0, 0x40));
}

export function readGamecubeGci(buffer: ArrayBuffer): CardSave[] {
  const data = new DataView(buffer);
  if (!isGamecubeGci(buffer) || data.getUint16(0x38) !== 11 || buffer.byteLength !== 0x16040)
    throw new Error('Choose an intact Digimon World 4 GameCube GCI save.');
  const save = buffer.slice(0x2040);
  if (new DataView(save).getUint32(4) !== 4) throw new Error('Unsupported GameCube save version.');
  return [{ name: text(new Uint8Array(buffer, 0, 6)) + ' · NDMWSaveData', data: save }];
}

export function isGamecubeCard(buffer: ArrayBuffer): boolean {
  if (![0x80000, 0x100000, 0x200000, 0x400000, 0x800000, 0x1000000].includes(buffer.byteLength))
    return false;
  const data = new DataView(buffer);
  return data.getUint16(0x22) * 0x20000 === buffer.byteLength && data.getUint16(0x24) <= 1;
}

/** Read-only GameCube directory/BAT reader; mirrored metadata and all file chains are validated. */
export function readGamecubeCard(buffer: ArrayBuffer): CardSave[] {
  if (!isGamecubeCard(buffer)) return fail('unsupported size or header geometry');
  const data = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const u16 = (offset: number) => data.getUint16(offset);
  function checksum(start: number, end: number, stored: number): boolean {
    let sum = 0,
      inverse = 0;
    for (let at = start; at < end; at += 2) {
      const value = u16(at);
      sum = (sum + value) & 0xffff;
      inverse = (inverse + (value ^ 0xffff)) & 0xffff;
    }
    return (
      (sum === 0xffff ? 0 : sum) === u16(stored) &&
      (inverse === 0xffff ? 0 : inverse) === u16(stored + 2)
    );
  }
  if (!checksum(0, 0x1fc, 0x1fc)) return fail('header checksum mismatch');
  const blocks = buffer.byteLength / BLOCK;
  const directories = [1, 2].map((b) =>
    checksum(b * BLOCK, b * BLOCK + 0x1ffc, b * BLOCK + 0x1ffc),
  );
  const bats = [3, 4].map((b) => {
    const base = b * BLOCK;
    let free = 0;
    for (let i = 0; i < blocks - 5; i++) if (u16(base + 0xa + i * 2) === 0) free++;
    return checksum(base + 4, base + BLOCK, base) && u16(base + 6) === free;
  });
  if ([...directories, ...bats].filter((ok) => !ok).length >= 2)
    return fail('directory or allocation copies are corrupt');
  function choose(valid: boolean[], a: number, b: number, counter: number) {
    if (!valid[0]) return b * BLOCK;
    if (!valid[1]) return a * BLOCK;
    return (
      (data.getInt16(a * BLOCK + counter) >= data.getInt16(b * BLOCK + counter) ? a : b) * BLOCK
    );
  }
  const directory = choose(directories, 1, 2, 0x1ffa);
  const bat = choose(bats, 3, 4, 4);
  const allocated = new Set<number>();
  const saves: CardSave[] = [];
  for (let index = 0; index < 127; index++) {
    const at = directory + index * 0x40;
    if (data.getUint32(at) === 0xffffffff) continue;
    const count = u16(at + 0x38);
    let block = u16(at + 0x36);
    if (count === 0 || count > blocks - 5) return fail('invalid file block count');
    const chain: number[] = [];
    for (let i = 0; i < count; i++) {
      if (block < 5 || block >= blocks || allocated.has(block))
        return fail('file chain loops, overlaps or leaves the card');
      allocated.add(block);
      chain.push(block);
      block = u16(bat + 0xa + (block - 5) * 2);
    }
    if (block !== 0xffff) return fail('file length does not match its allocation chain');
    if (!isSaveEntry(bytes.subarray(at, at + 0x40))) continue;
    if (count !== 11) return fail('invalid Digimon World 4 save size');
    const save = new Uint8Array(SAVE_SIZE);
    chain
      .slice(1)
      .forEach((b, i) => save.set(bytes.subarray(b * BLOCK, (b + 1) * BLOCK), i * BLOCK));
    if (new DataView(save.buffer).getUint32(4) !== 4)
      return fail('unsupported Digimon World 4 save version');
    saves.push({ name: text(bytes.subarray(at, at + 6)) + ' · NDMWSaveData', data: save.buffer });
  }
  if (!saves.length)
    throw new Error('No supported Digimon World 4 saves were found on this GameCube memory card.');
  return saves;
}
