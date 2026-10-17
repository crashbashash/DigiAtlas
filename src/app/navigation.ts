import { useEffect, useState } from 'preact/hooks';
import { clampPlayers } from '../data/model';
import { DIFFICULTIES, type Difficulty } from '../data/types';
import {
  DEFAULT_SETTINGS,
  formatHash,
  parseHash,
  type Location,
  type Route,
  type Settings,
} from './route';

const SETTINGS_KEY = 'digiatlas.settings';
const LAST_MAP_KEY = 'digiatlas.lastMap';
// The address format before pages existed; read once so people keep their last view.
const OLD_VIEW_KEY = 'digiatlas.view';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage can be unavailable; the view just is not remembered */
  }
}

/** The settings used when an address does not say: the last ones chosen. */
export function rememberedSettings(): Settings {
  const saved =
    read<Partial<Settings>>(SETTINGS_KEY) ?? read<Partial<Settings>>(OLD_VIEW_KEY) ?? {};
  return {
    difficulty: DIFFICULTIES.includes(saved.difficulty as Difficulty)
      ? (saved.difficulty as Difficulty)
      : DEFAULT_SETTINGS.difficulty,
    players: saved.players ? clampPlayers(saved.players) : DEFAULT_SETTINGS.players,
    showUnused: saved.showUnused === true,
  };
}

export const rememberSettings = (s: Settings): void => write(SETTINGS_KEY, s);

/** The stage last opened on the map page, to offer it again from home. */
export function lastMap(): string | null {
  return read<string>(LAST_MAP_KEY) ?? read<{ stageId?: string }>(OLD_VIEW_KEY)?.stageId ?? null;
}

export const rememberMap = (stageId: string): void => write(LAST_MAP_KEY, stageId);

/** Go to a page. `replace` refines the current entry instead of adding a step to Back. */
export function navigate(route: Route, settings: Settings, replace = false): void {
  const hash = formatHash(route, settings);
  if (hash === location.hash) return;
  if (replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = hash;
  }
}

/** The parsed address, kept current as it changes. */
export function useLocation(): Location {
  const [loc, setLoc] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const update = () => setLoc(parseHash(location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return loc;
}
