import type { DataSource } from './source';
import { dropTable, isUnused, itemKey, type DropRow } from './logic';
import type {
  DropPool,
  Difficulty,
  Enemy,
  EnemyKind,
  Generator,
  Item,
  RawData,
  Stage,
  Trader,
} from './types';
import {
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  VARIANT_DIFFICULTY,
  type AppraisalTier,
  type GearKind,
} from './types';

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

/** An unidentified item and everything the appraiser can make of it, by the player's level. */
export interface AppraisalTable {
  cost: number;
  /** Level ranges; neighbouring tiers that give the same results are one column. */
  columns: string[];
  rows: {
    key: string;
    label: string;
    /** Percent chance per column, 0 where it cannot come up. */ percents: number[];
  }[];
}

/** Where an item can come from at the appraiser: the unidentified item to take there and the chance per tier. */
export interface AppraisedFrom {
  cost: number;
  from: string;
  /** Level ranges where it can come up, neighbours with the same chance joined. */
  ranges: { label: string; percent: number }[];
}

/** "Lv 1–40", "Lv 401+"; several neighbouring tiers read as one range. */
export function levelRange(first: AppraisalTier, last: AppraisalTier = first): string {
  const low = Math.max(first.minLevel, 1);
  return last.maxLevel === null ? `Lv ${low}+` : `Lv ${low}–${last.maxLevel}`;
}

/** Runs of neighbouring tiers (by index) that `same` says are alike. */
function runs(tiers: AppraisalTier[], same: (a: number, b: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  tiers.forEach((_, i) => {
    const last = out[out.length - 1];
    if (last && same(last[1], i)) last[1] = i;
    else out.push([i, i]);
  });
  return out;
}

/**
 * The settings the numbers depend on besides difficulty: spawn counts and drops change with the
 * number of players, and spawners that no script starts can be left out. Passed to every
 * calculation that needs them instead of living on the model.
 */
export interface Scope {
  /** Number of players, 1 to 4. */
  players: number;
  /** Leave out spawners that no script starts (they most likely never appear). */
  hideUnused: boolean;
}

export const DEFAULT_SCOPE: Scope = { players: 1, hideUnused: true };

/** Clamp a player count to the game's 1 to 4. */
export const clampPlayers = (n: number): number => Math.min(4, Math.max(1, Math.round(n) || 1));

/** Where one enemy (by name) spawns in a stage, for a difficulty and scope. */
export interface SpeciesSpawn {
  stage: Stage;
  /** Spawners that place it. */
  spawners: number;
  /** How many it places in total (sum of the spawners' counts). */
  total: number;
  /** Stat rows used there (crown ranks, area tiers). */
  rows: number[];
}

/** A boss's part or minion and how many of it the boss's fight has. */
export interface BossPart {
  name: string;
  /** Its stat rows used in the fight, weakest first. */
  rows: Enemy[];
  /** How many the fight's spawners place in total (minions may come back once all are beaten). */
  count: number;
}

/** Something an enemy (by name) can drop: the best chance per kill and the rooms it applies in. */
export interface SpeciesDrop {
  key: string;
  category: string;
  percent: number;
  /** Rooms with that drop, best chance first. */
  stages: { stage: Stage; percent: number }[];
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

const AREA_ORDER = [
  'Death Valley',
  'Dry Land',
  'Venom Jungle',
  'Machine Pit',
  'Fortress',
  'Home Server',
];
const KIND_ORDER: Record<string, number> = { field: 0, dungeon: 1, boss: 2, hub: 3, system: 4 };
// The developers' Debug and Practice stages are not part of the game a player sees.
const DEV_STAGES = new Set(['stag0000', 'stag0001']);

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

  constructor(readonly raw: RawData) {
    for (const e of raw.enemies.rows) this.enemies.set(e.row, e);
    // The game's font uses these glyphs for elemental icons on ability chips.
    // Keep imported data intact while making labels, search and descriptions readable.
    const elements: Record<string, string> = {
      '⊂': 'Fire',
      '⊃': 'Ice',
      '∪': 'Thunder',
      '∩': 'Dark',
    };
    const chipText = (text: string) =>
      text.replace(/[⊂⊃∪∩][ \t]*/g, (icon) => `${elements[icon.trim()]} `);
    for (const i of raw.items.items) {
      const item =
        i.category === 'abChip'
          ? {
              ...i,
              name: chipText(i.name),
              description: i.description === null ? null : chipText(i.description),
            }
          : i;
      this.items.set(itemKey(i.category, i.id), item);
    }
    this.buildLabels();
    // Only stages that spawn something are worth browsing.
    this.stages = raw.stages.stages.filter(
      (s) =>
        !DEV_STAGES.has(s.id) &&
        (s.map !== null ||
          DIFFICULTIES.some((d) => (s.difficulties[d]?.generators.length ?? 0) > 0)),
    );
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
      keys.forEach((k, n) =>
        this.labels.set(k, keys.length > 1 ? `${name} (${n + 1} of ${keys.length})` : name),
      );
    }
  }

  itemLabel(key: string): string {
    return this.labels.get(key) ?? key;
  }

  get pools(): Record<string, DropPool> {
    return this.raw.drops.pools;
  }

  /**
   * Whether a spawner is a boss fight: a boss, an enemy the stage shows a boss health bar for, or
   * one whose kill always gives a key item (each dungeon boss drops its own ID, such as Blosso ID;
   * the Vine Tunnel Mecha Rogue 04 has no bar). Species like Mecha Rogue 04 are a boss in one room
   * and a regular enemy in others.
   */
  isBossFight(g: Generator): boolean {
    const kind = this.enemies.get(g.row)?.kind;
    if (kind === 'boss' || g.bossHealthBar) return true;
    if (kind === 'object') return false;
    const tables = [g, ...(g.players ?? [])].flatMap((e) => [
      ...Object.values(e.drops ?? {}),
      ...Object.values(e.lastDrops ?? {}),
    ]);
    return tables.some((name) =>
      this.pools[name]?.entries.some((x) => x.category === 'impItem' && x.rate >= 10000),
    );
  }

  private bossNames?: Set<string>;

  /** An enemy's kind by name: a boss when any of its spawners anywhere is a boss fight. */
  speciesKind(name: string): EnemyKind {
    if (!this.bossNames) {
      this.bossNames = new Set();
      for (const e of this.enemies.values()) if (e.kind === 'boss') this.bossNames.add(e.name);
      for (const s of this.raw.stages.stages)
        for (const d of DIFFICULTIES)
          for (const g of s.difficulties[d]?.generators ?? []) {
            const e = this.enemies.get(g.row);
            if (e && this.isBossFight(g)) this.bossNames.add(e.name);
          }
    }
    if (this.bossNames.has(name)) return 'boss';
    const rows = this.speciesRows(name);
    return rows.some((e) => e.kind === 'enemy') || !rows.length ? 'enemy' : rows[0].kind;
  }

  private buildWorlds(): World[] {
    const rooms = new Map<string, Room>();
    const sorted = [...this.stages].sort(
      (a, b) =>
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

  /** Indices of the spawners that are left out for this scope. */
  hidden(stage: Stage, d: Difficulty, scope: Scope = DEFAULT_SCOPE): Set<number> {
    const out = new Set<number>();
    if (!scope.hideUnused) return out;
    this.generators(stage, d, scope).forEach((g, i) => {
      if (isUnused(g, this.enemies.get(g.row))) out.add(i);
    });
    return out;
  }

  /** How many spawners no script starts in a stage, whether or not they are hidden. */
  unusedCount(stage: Stage, d: Difficulty): number {
    return this.generators(stage, d).filter((g) => isUnused(g, this.enemies.get(g.row))).length;
  }

  /** A spawner as it behaves for a number of players. */
  forPlayers(g: Generator, players: number): Generator {
    const n = clampPlayers(players);
    const slot = g.players?.[n - 1];
    if (!slot) return g;
    return {
      ...g,
      count: slot.count,
      maxCount: slot.maxCount,
      drops: slot.drops ?? g.drops,
      lastDrops: slot.lastDrops ?? g.lastDrops,
    };
  }

  generators(stage: Stage, d: Difficulty, scope: Scope = DEFAULT_SCOPE): Generator[] {
    const raw = stage.difficulties[d]?.generators ?? [];
    if (!raw.some((g) => g.players)) return raw;
    return raw.map((g) => this.forPlayers(g, scope.players));
  }

  /** Difficulties a stage actually has data for. */
  available(stage: Stage): Difficulty[] {
    // A shop has no spawners, but its traders still differ by difficulty.
    return DIFFICULTIES.filter(
      (d) =>
        (stage.difficulties[d]?.generators.length ?? 0) > 0 || this.tradersAt(stage, d).length > 0,
    );
  }

  poolFor(g: Generator, d: Difficulty, last = false): DropPool | null {
    const name = (last ? g.lastDrops : g.drops)?.[d];
    return name ? (this.pools[name] ?? null) : null;
  }

  tableFor(g: Generator, d: Difficulty, last = false) {
    return dropTable(this.poolFor(g, d, last));
  }

  /** Where an item drops (per kill) for one difficulty, best chance first. */
  sourcesOf(key: string, d: Difficulty, scope: Scope = DEFAULT_SCOPE): ItemSource[] {
    const cacheKey = `${d}:${clampPlayers(scope.players)}:${scope.hideUnused}`;
    let index = this.sourceCache.get(cacheKey);
    if (!index) {
      index = this.buildSources(d, scope);
      this.sourceCache.set(cacheKey, index);
    }
    return index.get(key) ?? [];
  }

  private buildSources(d: Difficulty, scope: Scope): Map<string, ItemSource[]> {
    const index = new Map<string, ItemSource[]>();
    for (const stage of this.stages) {
      const gens = this.generators(stage, d, scope);
      // A stage's spawners often share a pool, and several stat rows can be one enemy (crown ranks);
      // collapse them to one row per stage, enemy name and chance.
      const seen = new Map<string, ItemSource>();
      const rows = new Map<string, Set<number>>();
      gens.forEach((g, gi) => {
        const enemy = this.enemies.get(g.row);
        if (scope.hideUnused && isUnused(g, enemy)) return;
        const name = enemy?.name ?? `Row ${g.row}`;
        for (const row of this.tableFor(g, d).rows as DropRow[]) {
          const k = `${row.key}|${stage.id}|${name}|${row.rate}`;
          let src = seen.get(k);
          if (!src) {
            src = {
              stage,
              enemyName: name,
              kind: enemy?.kind ?? 'enemy',
              variants: 0,
              percent: row.percent,
              generators: [],
            };
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
  mapsFor(key: string, d: Difficulty, scope: Scope = DEFAULT_SCOPE): ItemMap[] {
    const byStage = new Map<string, ItemMap>();
    for (const src of this.sourcesOf(key, d, scope)) {
      let m = byStage.get(src.stage.id);
      if (!m) {
        m = { stage: src.stage, percent: 0, spawners: 0, droppedBy: [] };
        byStage.set(src.stage.id, m);
      }
      m.percent = Math.max(m.percent, src.percent);
      m.spawners += src.generators.length;
      if (!m.droppedBy.includes(src.enemyName)) m.droppedBy.push(src.enemyName);
    }
    return [...byStage.values()].sort(
      (a, b) => b.percent - a.percent || a.stage.id.localeCompare(b.stage.id),
    );
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
              const same = list.find(
                (l) =>
                  l.label === label &&
                  l.other === other &&
                  l.stage.room === stage.room &&
                  l.stage.floor === stage.floor,
              );
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

  private unidentified(category: GearKind): Item | undefined {
    return [...this.items.values()].find((i) => i.unidentified && i.category === category);
  }

  /** What an unidentified weapon, core or board can turn into; null for any other item. */
  appraisalTable(key: string): AppraisalTable | null {
    const a = this.raw.items.appraisal;
    const item = this.items.get(key);
    if (!a || !item?.unidentified) return null;
    const category = item.category as GearKind;
    const rows = new Map<string, number[]>();
    a.tiers.forEach((t, n) => {
      for (const r of t.results[category]) {
        const k = itemKey(r.category, r.id);
        if (!rows.has(k))
          rows.set(
            k,
            a.tiers.map(() => 0),
          );
        rows.get(k)![n] += r.rate / 100;
      }
    });
    const same = (x: number, y: number) => [...rows.values()].every((p) => p[x] === p[y]);
    const groups = runs(a.tiers, same);
    return {
      cost: a.cost,
      columns: groups.map(([from, to]) => levelRange(a.tiers[from], a.tiers[to])),
      rows: [...rows]
        .map(([k, percents]) => ({
          key: k,
          label: this.itemLabel(k),
          percents: groups.map(([from]) => percents[from]),
        }))
        .sort(
          (x, y) =>
            Math.max(...y.percents) - Math.max(...x.percents) || x.label.localeCompare(y.label),
        ),
    };
  }

  /** The tiers (player level ranges) in which the appraiser can turn something into this item. */
  appraisedFrom(key: string): AppraisedFrom | null {
    const a = this.raw.items.appraisal;
    const item = this.items.get(key);
    if (!a || !item || item.unidentified) return null;
    const category = item.category;
    if (category !== 'weapon' && category !== 'armor1' && category !== 'armor2') return null;
    const percent = a.tiers.map((tier) =>
      tier.results[category]
        .filter((r) => itemKey(r.category, r.id) === key)
        .reduce((n, r) => n + r.rate / 100, 0),
    );
    const ranges = runs(a.tiers, (x, y) => percent[x] === percent[y])
      .filter(([from]) => percent[from] > 0)
      .map(([from, to]) => ({
        label: levelRange(a.tiers[from], a.tiers[to]),
        percent: percent[from],
      }));
    const from = this.unidentified(category);
    return ranges.length && from
      ? { cost: a.cost, from: this.itemLabel(itemKey(from.category, from.id)), ranges }
      : null;
  }

  /** The traders in a room that have something to swap on this difficulty. */
  tradersAt(stage: Stage, d: Difficulty): Trader[] {
    return (stage.trades ?? []).filter((t) => (t.tables[d]?.length ?? 0) > 0);
  }

  /** The difficulty a shop's e/h/v copy is entered on (its tables are the ones that apply there). */
  entryDifficulty(stage: Stage): Difficulty | null {
    return stage.variant && !this.hasSpawns(stage) ? VARIANT_DIFFICULTY[stage.variant] : null;
  }

  /** Whether anything spawns in the room on any difficulty. */
  hasSpawns(stage: Stage): boolean {
    return DIFFICULTIES.some((d) => (stage.difficulties[d]?.generators.length ?? 0) > 0);
  }

  /** Short label for one of a room's stages: its floor and difficulty, or "Map N" when it has neither. */
  chipLabel(room: Room, s: Stage): string {
    const parts = [
      s.floor,
      s.variant ? DIFFICULTY_LABEL[VARIANT_DIFFICULTY[s.variant]] : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' ') : `Map ${room.stages.indexOf(s) + 1}`;
  }

  /** Every stat row with this name (an enemy's crown ranks and area tiers share it). */
  speciesRows(name: string): Enemy[] {
    return [...this.enemies.values()].filter((e) => e.name === name);
  }

  /** Where an enemy spawns on a difficulty, most placed first. */
  spawnsOf(name: string, d: Difficulty, scope: Scope = DEFAULT_SCOPE): SpeciesSpawn[] {
    const rows = new Set(this.speciesRows(name).map((e) => e.row));
    return this.spawnsForRows(rows, d, scope);
  }

  /** Locations for exactly one stat variant, using the current difficulty and spawn settings. */
  rowSpawns(row: number, d: Difficulty, scope: Scope = DEFAULT_SCOPE): SpeciesSpawn[] {
    return this.spawnsForRows(new Set([row]), d, scope);
  }

  private spawnsForRows(rows: Set<number>, d: Difficulty, scope: Scope): SpeciesSpawn[] {
    const out: SpeciesSpawn[] = [];
    for (const stage of this.stages) {
      const hidden = this.hidden(stage, d, scope);
      const gens = this.generators(stage, d, scope).filter(
        (g, i) => rows.has(g.row) && !hidden.has(i),
      );
      if (!gens.length) continue;
      out.push({
        stage,
        spawners: gens.length,
        total: gens.reduce((n, g) => n + (g.count ?? 0), 0),
        rows: [...new Set(gens.map((g) => g.row))],
      });
    }
    return out.sort(
      (a, b) => b.total - a.total || naturalKey(a.stage.id).localeCompare(naturalKey(b.stage.id)),
    );
  }

  /**
   * The stat rows an enemy uses on a difficulty, weakest first. When it spawns nowhere on that
   * difficulty, all of its rows, so its stats can still be looked up.
   */
  variantsOn(name: string, d: Difficulty, scope: Scope = DEFAULT_SCOPE): Enemy[] {
    const used = new Set(this.spawnsOf(name, d, scope).flatMap((s) => s.rows));
    const rows = this.speciesRows(name);
    const list = used.size ? rows.filter((e) => used.has(e.row)) : rows;
    return list.sort((a, b) => a.hp - b.hp || a.rarity - b.rarity || a.row - b.row);
  }

  /** Whether every row of this name is some boss's part or minion (Lucemon's orbs). */
  isPartOnly(name: string): boolean {
    const rows = this.speciesRows(name);
    return rows.length > 0 && rows.every((e) => e.role === 'part');
  }

  /**
   * A boss's parts and minions on a difficulty, counted in the rooms where the boss spawns. When the
   * boss spawns nowhere on it, every part row, with a count of 0.
   */
  partsOf(boss: string, d: Difficulty, scope: Scope = DEFAULT_SCOPE): BossPart[] {
    const partRows = new Map<number, Enemy>();
    for (const e of this.enemies.values())
      if (e.role === 'part' && e.partOf === boss) partRows.set(e.row, e);
    if (!partRows.size) return [];
    const byName = new Map<string, BossPart>();
    const add = (e: Enemy, count: number) => {
      let part = byName.get(e.name);
      if (!part) {
        part = { name: e.name, rows: [], count: 0 };
        byName.set(e.name, part);
      }
      if (!part.rows.includes(e)) part.rows.push(e);
      part.count += count;
    };
    const rooms = this.spawnsOf(boss, d, scope);
    for (const { stage } of rooms)
      for (const g of this.generators(stage, d, scope)) {
        const e = partRows.get(g.row);
        if (e) add(e, g.count ?? 0);
      }
    if (!rooms.length) for (const e of partRows.values()) add(e, 0);
    const out = [...byName.values()];
    for (const p of out) p.rows.sort((a, b) => a.hp - b.hp);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Everything an enemy can drop per kill on a difficulty, best chance first. */
  dropsOf(name: string, d: Difficulty, scope: Scope = DEFAULT_SCOPE): SpeciesDrop[] {
    const rows = new Set(this.speciesRows(name).map((e) => e.row));
    const byKey = new Map<string, SpeciesDrop>();
    for (const stage of this.stages) {
      const hidden = this.hidden(stage, d, scope);
      this.generators(stage, d, scope).forEach((g, i) => {
        if (!rows.has(g.row) || hidden.has(i)) return;
        for (const r of this.tableFor(g, d).rows) {
          let drop = byKey.get(r.key);
          if (!drop) {
            drop = { key: r.key, category: r.category, percent: 0, stages: [] };
            byKey.set(r.key, drop);
          }
          drop.percent = Math.max(drop.percent, r.percent);
          const here = drop.stages.find((x) => x.stage.id === stage.id);
          if (here) here.percent = Math.max(here.percent, r.percent);
          else drop.stages.push({ stage, percent: r.percent });
        }
      });
    }
    const out = [...byKey.values()];
    for (const drop of out) drop.stages.sort((a, b) => b.percent - a.percent);
    return out.sort((a, b) => b.percent - a.percent || a.key.localeCompare(b.key));
  }

  stageTitle(s: Stage): string {
    const base = s.room ?? s.id;
    const extra = [
      s.floor,
      s.variant ? `(${DIFFICULTY_LABEL[VARIANT_DIFFICULTY[s.variant]]})` : null,
    ]
      .filter(Boolean)
      .join(' ');
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
  if (manifest.schemaVersion !== 1)
    throw new Error(`Unsupported data version ${manifest.schemaVersion}`);
  return new Model({ manifest, enemies, items, drops, stages });
}
