import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { DataSource } from '../data/source';
import type { Model, Scope } from '../data/model';
import type { Route, Settings } from '../app/route';

/** What every page can reach: the data, the settings the numbers depend on, and navigation. */
export interface AppServices {
  model: Model;
  source: DataSource;
  settings: Settings;
  /** The settings as the model's calculations take them. */
  scope: Scope;
  go(route: Route, replace?: boolean): void;
  setSettings(patch: Partial<Settings>): void;
  openSearch(): void;
  /** Pick another exported data folder (desktop app only). */
  changeData: (() => void) | null;
}

export const AppContext = createContext<AppServices | null>(null);

export function useApp(): AppServices {
  const app = useContext(AppContext);
  if (!app) throw new Error('useApp outside the app');
  return app;
}
