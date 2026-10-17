import { DIFFICULTIES, type Difficulty } from '../data/types';

/**
 * Pages and their addresses. The settings the numbers depend on (difficulty, players, unused
 * spawners) ride along in the query of every page so a link reproduces what you saw.
 *
 *   #/                                  home
 *   #/search?q=sword&cat=weapon         all search results
 *   #/item/weapon:175                   an item (tabs: /drops, /trades)
 *   #/map/stag0102?item=weapon:175      a stage map, with something selected
 */

export type ItemTab = 'overview' | 'drops' | 'trades';
export const ITEM_TABS: ItemTab[] = ['overview', 'drops', 'trades'];

/** What is picked on a map page. Spawners are named, so the address survives a difficulty change. */
export type MapSelection =
  | { kind: 'none' }
  | { kind: 'spawner'; name: string }
  | { kind: 'group'; row: number }
  | { kind: 'item'; key: string }
  | { kind: 'species'; name: string };

export type Route =
  | { page: 'home' }
  | { page: 'search'; q: string; category: string | null }
  | { page: 'item'; key: string; tab: ItemTab }
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

export function parseHash(hash: string): Location {
  const [rawPath, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const q = new URLSearchParams(query);
  const settings = parseSettings(q);
  const parts = rawPath.split('/').filter(Boolean).map(decodeURIComponent);
  const [first, second, third] = parts;
  if (!first) return { route: { page: 'home' }, settings };
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

export function formatHash(route: Route, s: Settings): string {
  const q = new URLSearchParams();
  let path: string;
  switch (route.page) {
    case 'home':
      return '#/';
    case 'search':
      if (route.q) q.set('q', route.q);
      if (route.category) q.set('cat', route.category);
      path = 'search';
      break;
    case 'item':
      settingsQuery(s, q);
      path = `item/${encodeURIComponent(route.key)}${route.tab === 'overview' ? '' : `/${route.tab}`}`;
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
  home: (): Route => ({ page: 'home' }),
  search: (q = '', category: string | null = null): Route => ({ page: 'search', q, category }),
  item: (key: string, tab: ItemTab = 'overview'): Route => ({ page: 'item', key, tab }),
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
