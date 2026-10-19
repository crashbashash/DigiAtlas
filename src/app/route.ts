import { DIFFICULTIES, type Difficulty } from '../data/types';

/**
 * Pages and their addresses. The settings the numbers depend on (difficulty, players, unused
 * spawners) ride along in the query of every page so a link reproduces what you saw.
 *
 *   #/                                  home
 *   #/search?q=sword&cat=weapon         all search results
 *   #/item/weapon:175                   an item (tabs: /drops, /trades)
 *   #/map/stag0102?item=weapon:175      a stage map, with something selected
 *   #/enemy/Goburimon                   an enemy (tabs: /spawns, /drops)
 *   #/items?cat=weapon&sort=strength    the item table, filtered and sorted
 *   #/enemies?kind=boss&view=resist     the enemy table
 */

export type Calculator = 'power-up' | 'power-down' | 'attack-damage' | 'mp-tech';

export type ItemTab = 'overview' | 'drops' | 'trades';
export const ITEM_TABS: ItemTab[] = ['overview', 'drops', 'trades'];
export type EnemyTab = 'overview' | 'spawns' | 'drops';
export const ENEMY_TABS: EnemyTab[] = ['overview', 'spawns', 'drops'];

/** A table's sort: a column id and its direction. A null column is the table's own default order. */
export interface Sort {
  column: string | null;
  desc: boolean;
}

export type EnemyKindFilter = 'all' | 'enemy' | 'boss';
export type EnemyView = 'stats' | 'resist';

/** What is picked on a map page. Spawners are named, so the address survives a difficulty change. */
export type MapSelection =
  | { kind: 'none' }
  | { kind: 'spawner'; name: string }
  | { kind: 'group'; row: number }
  | { kind: 'item'; key: string }
  | { kind: 'species'; name: string };

export type Route =
  | { page: 'home' }
  | { page: 'calculators' }
  | { page: 'calculator'; calculator: Calculator }
  | { page: 'search'; q: string; category: string | null }
  | { page: 'item'; key: string; tab: ItemTab }
  | { page: 'enemy'; name: string; tab: EnemyTab }
  | { page: 'items'; category: string | null; q: string; sort: Sort }
  | { page: 'enemies'; kind: EnemyKindFilter; q: string; sort: Sort; view: EnemyView }
  | { page: 'map'; stageId: string | null; selection: MapSelection; zoom: boolean };

export interface Settings {
  difficulty: Difficulty;
  /** Number of players, 1 to 4. */
  players: number;
  /** Also show spawners that no script starts. */
  showUnused: boolean;
}

export const DEFAULT_SETTINGS: Settings = { difficulty: 'hard', players: 1, showUnused: false };

export interface Location {
  route: Route;
  /** Settings written in the address; anything missing falls back to the remembered ones. */
  settings: Partial<Settings>;
}

function parseSettings(q: URLSearchParams): Partial<Settings> {
  const out: Partial<Settings> = {};
  const d = q.get('d');
  if (DIFFICULTIES.includes(d as Difficulty)) out.difficulty = d as Difficulty;
  const p = Number(q.get('p'));
  if ([1, 2, 3, 4].includes(p)) out.players = p;
  if (q.has('u')) out.showUnused = q.get('u') === '1';
  return out;
}

function parseSelection(q: URLSearchParams): MapSelection {
  const item = q.get('item');
  if (item) return { kind: 'item', key: item };
  const enemy = q.get('enemy');
  if (enemy) return { kind: 'species', name: enemy };
  const spawner = q.get('spawner');
  if (spawner) return { kind: 'spawner', name: spawner };
  const group = Number(q.get('group'));
  if (q.has('group') && Number.isInteger(group)) return { kind: 'group', row: group };
  return { kind: 'none' };
}

function parseSort(q: URLSearchParams): Sort {
  return { column: q.get('sort'), desc: q.get('dir') === 'desc' };
}

export function parseHash(hash: string): Location {
  const [rawPath, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const q = new URLSearchParams(query);
  const settings = parseSettings(q);
  const parts = rawPath.split('/').filter(Boolean).map(decodeURIComponent);
  const [first, second, third] = parts;
  if (!first) return { route: { page: 'home' }, settings };
  if (first === 'search' && q.get('cat') && !q.get('q')) {
    // Category listings used to be searches; they are the item table now.
    return {
      route: { page: 'items', category: q.get('cat'), q: '', sort: { column: null, desc: false } },
      settings,
    };
  }
  if (first === 'calculators') {
    if (second === 'weapon-damage')
      return { route: { page: 'calculator', calculator: 'attack-damage' }, settings };
    if (
      second === 'power-up' ||
      second === 'power-down' ||
      second === 'attack-damage' ||
      second === 'mp-tech'
    )
      return { route: { page: 'calculator', calculator: second }, settings };
    return { route: { page: 'calculators' }, settings };
  }
  if (first === 'items')
    return {
      route: { page: 'items', category: q.get('cat'), q: q.get('q') ?? '', sort: parseSort(q) },
      settings,
    };
  if (first === 'enemies') {
    const kind = q.get('kind');
    return {
      route: {
        page: 'enemies',
        kind: kind === 'enemy' || kind === 'boss' ? kind : 'all',
        q: q.get('q') ?? '',
        sort: parseSort(q),
        view: q.get('view') === 'resist' ? 'resist' : 'stats',
      },
      settings,
    };
  }
  if (first === 'enemy' && second) {
    const tab = ENEMY_TABS.includes(third as EnemyTab) ? (third as EnemyTab) : 'overview';
    return { route: { page: 'enemy', name: second, tab }, settings };
  }
  if (first === 'search')
    return { route: { page: 'search', q: q.get('q') ?? '', category: q.get('cat') }, settings };
  if (first === 'item' && second) {
    const tab = ITEM_TABS.includes(third as ItemTab) ? (third as ItemTab) : 'overview';
    return { route: { page: 'item', key: second, tab }, settings };
  }
  // The old item window (#/popout?item=...) is now the item page.
  if (first === 'popout') {
    const item = q.get('item');
    return {
      route: item ? { page: 'item', key: item, tab: 'overview' } : { page: 'home' },
      settings,
    };
  }
  const map = (stageId: string | null): Location => ({
    route: { page: 'map', stageId, selection: parseSelection(q), zoom: q.get('zoom') === '1' },
    settings,
  });
  if (first === 'map') return map(second ?? null);
  // Before pages existed the address was just the stage (#/stag0102?d=hard); keep those links working.
  if (/^[A-Za-z0-9_]+$/.test(first) && parts.length === 1) return map(first);
  return { route: { page: 'home' }, settings };
}

function settingsQuery(s: Settings, q: URLSearchParams): void {
  q.set('d', s.difficulty);
  if (s.players !== 1) q.set('p', String(s.players));
  if (s.showUnused) q.set('u', '1');
}

function sortQuery(sort: Sort, q: URLSearchParams): void {
  if (!sort.column) return;
  q.set('sort', sort.column);
  if (sort.desc) q.set('dir', 'desc');
}

export function formatHash(route: Route, s: Settings): string {
  const q = new URLSearchParams();
  let path: string;
  switch (route.page) {
    case 'home':
      return '#/';
    case 'calculator':
      settingsQuery(s, q);
      path = `calculators/${route.calculator}`;
      break;
    case 'calculators':
      settingsQuery(s, q);
      path = 'calculators';
      break;
    case 'search':
      if (route.q) q.set('q', route.q);
      if (route.category) q.set('cat', route.category);
      path = 'search';
      break;
    case 'item':
      settingsQuery(s, q);
      path = `item/${encodeURIComponent(route.key)}${route.tab === 'overview' ? '' : `/${route.tab}`}`;
      break;
    case 'enemy':
      settingsQuery(s, q);
      path = `enemy/${encodeURIComponent(route.name)}${route.tab === 'overview' ? '' : `/${route.tab}`}`;
      break;
    case 'items':
      settingsQuery(s, q);
      if (route.category) q.set('cat', route.category);
      if (route.q) q.set('q', route.q);
      sortQuery(route.sort, q);
      path = 'items';
      break;
    case 'enemies':
      settingsQuery(s, q);
      if (route.kind !== 'all') q.set('kind', route.kind);
      if (route.q) q.set('q', route.q);
      if (route.view !== 'stats') q.set('view', route.view);
      sortQuery(route.sort, q);
      path = 'enemies';
      break;
    case 'map': {
      settingsQuery(s, q);
      const sel = route.selection;
      if (sel.kind === 'item') q.set('item', sel.key);
      else if (sel.kind === 'species') q.set('enemy', sel.name);
      else if (sel.kind === 'spawner') q.set('spawner', sel.name);
      else if (sel.kind === 'group') q.set('group', String(sel.row));
      if (route.zoom) q.set('zoom', '1');
      path = `map${route.stageId ? `/${encodeURIComponent(route.stageId)}` : ''}`;
      break;
    }
  }
  const query = q.toString();
  return `#/${path}${query ? `?${query}` : ''}`;
}

/** Shorthand for the common links. */
export const routes = {
  calculator: (calculator: Calculator): Route => ({ page: 'calculator', calculator }),
  calculators: (): Route => ({ page: 'calculators' }),
  home: (): Route => ({ page: 'home' }),
  search: (q = '', category: string | null = null): Route => ({ page: 'search', q, category }),
  item: (key: string, tab: ItemTab = 'overview'): Route => ({ page: 'item', key, tab }),
  enemy: (name: string, tab: EnemyTab = 'overview'): Route => ({ page: 'enemy', name, tab }),
  items: (
    category: string | null = null,
    q = '',
    sort: Sort = { column: null, desc: false },
  ): Route => ({
    page: 'items',
    category,
    q,
    sort,
  }),
  enemies: (
    kind: EnemyKindFilter = 'all',
    q = '',
    sort: Sort = { column: null, desc: false },
    view: EnemyView = 'stats',
  ): Route => ({ page: 'enemies', kind, q, sort, view }),
  map: (
    stageId: string | null,
    selection: MapSelection = { kind: 'none' },
    zoom = false,
  ): Route => ({
    page: 'map',
    stageId,
    selection,
    zoom,
  }),
};
