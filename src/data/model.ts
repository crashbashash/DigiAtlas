import type { DataSource } from './source';
import { dropTable, itemKey, type DropRow } from './logic';
import type { DropPool, Difficulty, Enemy, Generator, Item, RawData, Stage } from './types';
import { DIFFICULTIES } from './types';

export interface Room {
  area: string;
  room: string;
  stages: Stage[]; // floors / variants of one room
}

export interface World {
  area: string;
  rooms: Room[];
}

export interface ItemSource {
  stage: Stage;
  enemyRow: number;
  /** Chance per kill, as a percentage. */
  percent: number;
  /** Indices of the generators (in that stage and difficulty) that use this drop table. */
  generators: number[];
}

const AREA_ORDER = ['Death Valley', 'Dry Land', 'Venom Jungle', 'Machine Pit', 'Fortress', 'Home Server'];
const KIND_ORDER: Record<string, number> = { field: 0, dungeon: 1, boss: 2, hub: 3, system: 4 };
// Test stages go to the bottom of their world.
const LAST = new Set(['stag0000', 'stag0001']);

function naturalKey(id: string): string {
  return id.replace(/\d+/g, (n) => n.padStart(4, '0'));
}

export class Model {
  readonly enemies = new Map<number, Enemy>();
  readonly items = new Map<string, Item>();
  readonly stages: Stage[];
  readonly byId = new Map<string, Stage>();
  readonly worlds: World[];
  private readonly sourceCache = new Map<Difficulty, Map<string, ItemSource[]>>();

  constructor(readonly raw: RawData) {
    for (const e of raw.enemies.rows) this.enemies.set(e.row, e);
    for (const i of raw.items.items) this.items.set(itemKey(i.category, i.id), i);
    // Only stages that spawn something are worth browsing.
    this.stages = raw.stages.stages.filter((s) => DIFFICULTIES.some((d) => (s.difficulties[d]?.generators.length ?? 0) > 0));
    for (const s of this.stages) this.byId.set(s.id, s);
    this.worlds = this.buildWorlds();
  }

  get pools(): Record<string, DropPool> {
    return this.raw.drops.pools;
  }

  private buildWorlds(): World[] {
    const rooms = new Map<string, Room>();
    const sorted = [...this.stages].sort(
      (a, b) =>
        Number(LAST.has(a.id)) - Number(LAST.has(b.id)) ||
        (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) ||
        naturalKey(a.id).localeCompare(naturalKey(b.id)),
    );
    for (const s of sorted) {
      const area = s.area ?? 'Other';
      const key = `${area}|${s.room ?? s.id}`;
      let room = rooms.get(key);
      if (!room) {
        room = { area, room: s.room ?? s.id, stages: [] };
        rooms.set(key, room);
      }
      room.stages.push(s);
    }
    const worlds = new Map<string, World>();
    for (const r of rooms.values()) {
      let w = worlds.get(r.area);
      if (!w) {
        w = { area: r.area, rooms: [] };
        worlds.set(r.area, w);
      }
      w.rooms.push(r);
    }
    const rank = (a: string): number => {
      const i = AREA_ORDER.indexOf(a);
      return i < 0 ? 99 : i;
    };
    return [...worlds.values()].sort((a, b) => rank(a.area) - rank(b.area));
  }

  generators(stage: Stage, d: Difficulty): Generator[] {
    return stage.difficulties[d]?.generators ?? [];
  }

  /** Difficulties a stage actually has data for. */
  available(stage: Stage): Difficulty[] {
    return DIFFICULTIES.filter((d) => (stage.difficulties[d]?.generators.length ?? 0) > 0);
  }

  poolFor(g: Generator, d: Difficulty, last = false): DropPool | null {
    const name = (last ? g.lastDrops : g.drops)?.[d];
    return name ? (this.pools[name] ?? null) : null;
  }

  tableFor(g: Generator, d: Difficulty, last = false) {
    return dropTable(this.poolFor(g, d, last));
  }

  /** Where an item drops (per kill) for one difficulty, best chance first. */
  sourcesOf(key: string, d: Difficulty): ItemSource[] {
    let index = this.sourceCache.get(d);
    if (!index) {
      index = this.buildSources(d);
      this.sourceCache.set(d, index);
    }
    return index.get(key) ?? [];
  }

  private buildSources(d: Difficulty): Map<string, ItemSource[]> {
    const index = new Map<string, ItemSource[]>();
    for (const stage of this.stages) {
      const gens = this.generators(stage, d);
      // A stage's generators often share a pool; collapse them to one row per stage + enemy + chance.
      const seen = new Map<string, ItemSource>();
      gens.forEach((g, gi) => {
        for (const row of this.tableFor(g, d).rows as DropRow[]) {
          const k = `${row.key}|${stage.id}|${g.row}|${row.rate}`;
          let src = seen.get(k);
          if (!src) {
            src = { stage, enemyRow: g.row, percent: row.percent, generators: [] };
            seen.set(k, src);
            const list = index.get(row.key);
            if (list) list.push(src);
            else index.set(row.key, [src]);
          }
          src.generators.push(gi);
        }
      });
    }
    for (const list of index.values()) list.sort((a, b) => b.percent - a.percent);
    return index;
  }

  stageTitle(s: Stage): string {
    const base = s.room ?? s.id;
    const extra = [s.floor, s.variant ? `(${s.variant})` : null].filter(Boolean).join(' ');
    return extra ? `${base} ${extra}` : base;
  }
}

export async function loadModel(source: DataSource): Promise<Model> {
  const [manifest, enemies, items, drops, stages] = await Promise.all([
    source.json<RawData['manifest']>('manifest.json'),
    source.json<RawData['enemies']>('enemies.json'),
    source.json<RawData['items']>('items.json'),
    source.json<RawData['drops']>('drops.json'),
    source.json<RawData['stages']>('stages.json'),
  ]);
  if (manifest.schemaVersion !== 1) throw new Error(`Unsupported data version ${manifest.schemaVersion}`);
  return new Model({ manifest, enemies, items, drops, stages });
}
