/** Read-only PS2 memory-card filesystem, including raw/ECC-less and ECC page layouts.
 * FAT and directory layout: PCSX2 Reference/PS2-MemoryCardFileSystem.htm.
 */
export interface CardSave {
  name: string;
  data: ArrayBuffer;
}

export function readMemoryCard(buffer: ArrayBuffer): CardSave[] {
  const bytes = new Uint8Array(buffer);
  const magic = 'Sony PS2 Memory Card Format ';
  const fail = (): never => {
    throw new Error('The memory card is damaged or has an unsupported format.');
  };
  if (bytes.length < 340 || new TextDecoder().decode(bytes.subarray(0, magic.length)) !== magic) {
    throw new Error('Choose a PS2 memory-card image or a Digimon World 4 save file.');
  }
  const header = new DataView(buffer);
  const pageSize = header.getUint16(40, true);
  const pagesPerCluster = header.getUint16(42, true);
  const clusters = header.getUint32(48, true);
  const allocOffset = header.getUint32(52, true);
  const allocEnd = header.getUint32(56, true);
  const root = header.getUint32(60, true);
  if (
    pageSize !== 512 ||
    pagesPerCluster !== 2 ||
    clusters < 16 ||
    clusters > 131072 ||
    allocOffset < 1 ||
    allocEnd < 1 ||
    allocOffset + allocEnd > clusters
  )
    fail();
  const pages = clusters * pagesPerCluster;
  const stride =
    bytes.length === pages * pageSize
      ? pageSize
      : bytes.length === pages * (pageSize + 16)
        ? pageSize + 16
        : fail();
  const clusterSize = pageSize * pagesPerCluster;
  const perTable = clusterSize / 4;
  const cache = new Map<number, Uint8Array>();
  function cluster(index: number): Uint8Array {
    if (!Number.isInteger(index) || index < 0 || index >= clusters) fail();
    const previous = cache.get(index);
    if (previous) return previous;
    const result = new Uint8Array(clusterSize);
    for (let p = 0; p < pagesPerCluster; p++) {
      const offset = (index * pagesPerCluster + p) * stride;
      result.set(bytes.subarray(offset, offset + pageSize), p * pageSize);
    }
    cache.set(index, result);
    return result;
  }
  const u32 = (data: Uint8Array, offset: number) =>
    new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
  function next(index: number): number {
    const table = Math.floor(index / perTable);
    const indirectIndex = Math.floor(table / perTable);
    if (indirectIndex >= 32) return fail();
    const indirect = header.getUint32(80 + indirectIndex * 4, true);
    const fat = u32(cluster(indirect), (table % perTable) * 4);
    return u32(cluster(fat), (index % perTable) * 4);
  }
  function chain(start: number, length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || length > allocEnd * clusterSize)
      return fail();
    const result = new Uint8Array(length);
    const seen = new Set<number>();
    let index = start;
    for (let offset = 0; offset < length; offset += clusterSize) {
      if (index < 0 || index >= allocEnd || seen.has(index)) fail();
      seen.add(index);
      result.set(
        cluster(allocOffset + index).subarray(0, Math.min(clusterSize, length - offset)),
        offset,
      );
      const link = next(index);
      if ((link & 0x80000000) === 0) fail();
      if (offset + clusterSize < length) {
        if (link === 0xffffffff) fail();
        index = link & 0x7fffffff;
      } else if (link !== 0xffffffff) fail();
    }
    return result;
  }
  interface Entry {
    name: string;
    mode: number;
    length: number;
    cluster: number;
  }
  function directory(start: number, count?: number): Entry[] {
    if (start >= allocEnd) return fail();
    const length = count ?? u32(cluster(allocOffset + start), 4);
    if (length < 2 || length > allocEnd * 2) return fail();
    const data = chain(start, length * 512);
    const entries: Entry[] = [];
    for (let offset = 0; offset < data.length; offset += 512) {
      const mode = u32(data, offset) & 0xffff;
      if (!(mode & 0x8000)) continue;
      const name = new TextDecoder().decode(data.subarray(offset + 64, offset + 96)).split('\0')[0];
      if (name === '.' || name === '..') continue;
      entries.push({ name, mode, length: u32(data, offset + 4), cluster: u32(data, offset + 16) });
    }
    return entries;
  }
  const prefixes = ['BASLUS-20836', 'BESLES-53405', 'BISLPS-25453'];
  const saves: CardSave[] = [];
  for (const dir of directory(root)) {
    const prefix = prefixes.find((p) => dir.name.startsWith(p));
    if (!(dir.mode & 0x20) || !prefix) continue;
    for (const file of directory(dir.cluster, dir.length)) {
      if (!(file.mode & 0x10) || !file.name.startsWith(prefix)) continue;
      if (file.length !== 81920) fail();
      saves.push({ name: dir.name, data: chain(file.cluster, file.length).buffer as ArrayBuffer });
    }
  }
  if (!saves.length)
    throw new Error('No supported Digimon World 4 saves were found on this memory card.');
  return saves;
}
