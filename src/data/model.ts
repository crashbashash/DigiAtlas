import type { DataSource } from './source';
import { dropTable, isUnused, itemKey, type DropRow } from './logic';
import type { DropPool, Difficulty, Enemy, EnemyKind, Generator, Item, RawData, Stage, Trader } from './types';
import { DIFFICULTIES } from './types';

export interface Room {
  area: string;
  room: string;
  stages: Stage[]; // floors / variants of one room
}

/** One map an item drops in. */
export interface ItemMap {
  stage: Stage;
  /** Best chance per kill on this map, as a percentage. */
  percent: number;
  /** Spawners on the map that can drop it. */
  spawners: number;
  /** What drops it, best first (names only). */
  droppedBy: string[];
}

/** A trade offer seen from one item: which trader, in which room, and the item on the other side. */
export interface TradeLink {
  stage: Stage;
  /** "Agumon", or "Agumon 2" when the room has several. */
  label: string;
  other: string;
  /** The difficulties on which the trader offers it. */
  difficulties: Difficulty[];
}

/** "Agumon", or "Agumon 2" when a room has several. */
export function traderLabel(t: Trader): string {
  return t.number ? `${t.trader} ${t.number}` : t.trader;
}

export interface World {
  area: string;
  rooms: Room[];
}

export interface ItemSource {
  stage: Stage;
  enemyName: string;
  kind: EnemyKind;
  /** Stat rows that share this name and chance in the stage (crown ranks and the like). */
  variants: number;
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
  private readonly labels = new Map<string, string>();
  readonly stages: Stage[];
  readonly byId = new Map<string, Stage>();
  readonly worlds: World[];
  private readonly sourceCache = new Map<string, Map<string, ItemSource[]>>();
  private playerCount = 1;
  private hide = true;

  constructor(readonly raw: RawData) {
    for (const e of raw.enemies.rows) this.enemies.set(e.row, e);
    for (const i of raw.items.items) this.items.set(itemKey(i.category, i.id), i);
    this.buildLabels();
    // Only stages that spawn something are worth browsing.
    this.stages = raw.stages.stages.filter((s) => s.map !== null || DIFFICULTIES.some((d) => (s.difficulties[d]?.generators.length ?? 0) > 0));
    for (const s of this.stages) this.byId.set(s.id, s);
    this.worlds = this.buildWorlds();
  }

  /** The game has several items with one name (three X-Data, paired plugs); number them. */
  private buildLabels(): void {
    const groups = new Map<string, string[]>();
    for (const [key, i] of this.items) {
      const list = groups.get(i.name);
      if (list) list.push(key);
      else groups.set(i.name, [key]);
    }
    for (const [name, keys] of groups) {
      keys.forEach((k, n) => this.labels.set(k, keys.length > 1 ? `${name} (${n + 1} of ${keys.length})` : name));
    }
  }

  itemLabel(key: string): string {
    return this.labels.get(key) ?? key;
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

  /** How many players the numbers are for (1 to 4). Spawn counts and drops depend on it. */
  get players(): number {
    return this.playerCount;
  }

  set players(n: number) {
    this.playerCount = Math.min(4, Math.max(1, Math.round(n)));
  }

  /** Leave out spawners that no script starts (they most likely never appear). */
  get hideUnused(): boolean {
    return this.hide;
  }

  set hideUnused(v: boolean) {
    this.hide = v;
  }

  /** Indices of the spawners that are currently left out. */
  hidden(stage: Stage, d: Difficulty): Set<number> {
    const out = new Set<number>();
    if (!this.hide) return out;
    this.generators(stage, d).forEach((g, i) => {
      if (isUnused(g, this.enemies.get(g.row))) out.add(i);
    });
    return out;
  }

  /** How many spawners no script starts in a stage, whether or not they are hidden. */
  unusedCount(stage: Stage, d: Difficulty): number {
    return this.generators(stage, d).filter((g) => isUnused(g, this.enemies.get(g.row))).length;
  }

  /** A spawner as it behaves for the chosen number of players. */
  forPlayers(g: Generator): Generator {
    const slot = g.players?.[this.playerCount - 1];
    if (!slot || this.playerCount === 1 && !g.players) return g;
    return {
      ...g,
      count: slot.count,
      maxCount: slot.maxCount,
      drops: slot.drops ?? g.drops,
      lastDrops: slot.lastDrops ?? g.lastDrops,
    };
  }

  generators(stage: Stage, d: Difficulty): Generator[] {
    const raw = stage.difficulties[d]?.generators ?? [];
    if (this.playerCount === 1 && !raw.some((g) => g.players)) return raw;
    return raw.map((g) => this.forPlayers(g));
  }

  /** Difficulties a stage actually has data for. */
  available(stage: Stage): Difficulty[] {
    // A shop has no spawners, but its traders still differ by difficulty.
    return DIFFICULTIES.filter((d) => (stage.difficulties[d]?.generators.length ?? 0) > 0 || this.tradersAt(stage, d).length > 0);
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
    const cacheKey = `${d}:${this.playerCount}:${this.hide}`;
    let index = this.sourceCache.get(cacheKey);
    if (!index) {
      index = this.buildSources(d);
      this.sourceCache.set(cacheKey, index);
    }
    return index.get(key) ?? [];
  }

  private buildSources(d: Difficulty): Map<string, ItemSource[]> {
    const index = new Map<string, ItemSource[]>();
    for (const stage of this.stages) {
      const gens = this.generators(stage, d);
      // A stage's spawners often share a pool, and several stat rows can be one enemy (crown ranks);
      // collapse them to one row per stage, enemy name and chance.
      const seen = new Map<string, ItemSource>();
      const rows = new Map<string, Set<number>>();
      gens.forEach((g, gi) => {
        const enemy = this.enemies.get(g.row);
        if (this.hide && isUnused(g, enemy)) return;
        const name = enemy?.name ?? `Row ${g.row}`;
        for (const row of this.tableFor(g, d).rows as DropRow[]) {
          const k = `${row.key}|${stage.id}|${name}|${row.rate}`;
          let src = seen.get(k);
          if (!src) {
            src = { stage, enemyName: name, kind: enemy?.kind ?? 'enemy', variants: 0, percent: row.percent, generators: [] };
            seen.set(k, src);
            rows.set(k, new Set());
            const list = index.get(row.key);
            if (list) list.push(src);
            else index.set(row.key, [src]);
          }
          src.generators.push(gi);
          rows.get(k)!.add(g.row);
          src.variants = rows.get(k)!.size;
        }
      });
    }
    for (const list of index.values()) list.sort((a, b) => b.percent - a.percent);
    return index;
  }

  /** The maps an item drops in for the chosen difficulty and player count, best chance first. */
  mapsFor(key: string, d: Difficulty): ItemMap[] {
    const byStage = new Map<string, ItemMap>();
    for (const src of this.sourcesOf(key, d)) {
      let m = byStage.get(src.stage.id);
      if (!m) {
        m = { stage: src.stage, percent: 0, spawners: 0, droppedBy: [] };
        byStage.set(src.stage.id, m);
      }
      m.percent = Math.max(m.percent, src.percent);
      m.spawners += src.generators.length;
      if (!m.droppedBy.includes(src.enemyName)) m.droppedBy.push(src.enemyName);
    }
    return [...byStage.values()].sort((a, b) => b.percent - a.percent || a.stage.id.localeCompare(b.stage.id));
  }

  /** The traders who hand an item over (`getFrom`) and the ones who take it in (`giveTo`). */
  tradesFor(key: string): { getFrom: TradeLink[]; giveTo: TradeLink[] } {
    const out = { getFrom: [] as TradeLink[], giveTo: [] as TradeLink[] };
    for (const stage of this.stages) {
      for (const t of stage.trades ?? []) {
        const label = traderLabel(t);
        for (const d of DIFFICULTIES) {
          for (const o of t.tables[d] ?? []) {
            const give = itemKey(o.give.category, o.give.id);
            const get = itemKey(o.get.category, o.get.id);
            // The variants of a room (e/h/v) share traders; list each trade once, with the difficulties it applies on.
            const add = (list: TradeLink[], other: string) => {
              const same = list.find((l) => l.label === label && l.other === other && l.stage.room === stage.room && l.stage.floor === stage.floor);
              if (!same) list.push({ stage, label, other, difficulties: [d] });
              else if (!same.difficulties.includes(d)) same.difficulties.push(d);
            };
            if (get === key) add(out.getFrom, this.itemLabel(give));
            if (give === key) add(out.giveTo, this.itemLabel(get));
          }
        }
      }
    }
    return out;
  }

  /** The traders in a room that have something to swap on this difficulty. */
  tradersAt(stage: Stage, d: Difficulty): Trader[] {
    return (stage.trades ?? []).filter((t) => (t.tables[d]?.length ?? 0) > 0);
  }

  /** Whether anything spawns in the room on any difficulty. */
  hasSpawns(stage: Stage): boolean {
    return DIFFICULTIES.some((d) => (stage.difficulties[d]?.generators.length ?? 0) > 0);
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
