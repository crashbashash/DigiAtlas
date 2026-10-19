import { useEffect, useMemo, useState } from 'preact/hooks';
import { navigate, rememberedSettings, rememberSettings, useLocation } from '../app/navigation';
import { routes, type Route, type Settings } from '../app/route';
import type { DataSource } from '../data/source';
import type { Model } from '../data/model';
import { Link } from './common';
import logoUrl from './logo.svg';
import { AppContext, type AppServices } from './context';
import { Calculators } from './Calculators';
import { PowerCalculator } from './PowerCalculator';
import { WeaponDamageCalculator } from './WeaponDamageCalculator';
import { Home } from './Home';
import { UpdateCenter } from './UpdateCenter';
import { ItemPage } from './ItemPage';
import { MapPage } from './map/MapPage';
import { SearchBox } from './SearchBox';
import { SearchPage } from './SearchPage';
import { EnemyPage } from './EnemyPage';
import { ItemsTable } from './ItemsTable';
import { EnemiesTable } from './EnemiesTable';

function pageTitle(model: Model, route: Route): string {
  switch (route.page) {
    case 'home':
      return 'DigiAtlas';
    case 'calculator':
      return `${route.calculator === 'attack-damage' ? 'Attack damage' : route.calculator === 'power-up' ? 'Power Up' : 'Power Down'} · DigiAtlas`;
    case 'calculators':
      return 'Calculators · DigiAtlas';
    case 'search':
      return 'Search · DigiAtlas';
    case 'item':
      return `${model.items.has(route.key) ? model.itemLabel(route.key) : 'Item'} · DigiAtlas`;
    case 'enemy':
      return `${route.name} · DigiAtlas`;
    case 'items':
      return 'Items · DigiAtlas';
    case 'enemies':
      return `${route.kind === 'boss' ? 'Bosses' : 'Enemies'} · DigiAtlas`;
    case 'map': {
      const stage = route.stageId ? model.byId.get(route.stageId) : undefined;
      return `${stage ? model.stageTitle(stage) : 'Maps'} · DigiAtlas`;
    }
  }
}

/** Search from anywhere: `/` or the header button opens it, Escape or picking a result closes it. */
function SearchOverlay({ close }: { close(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);
  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="overlay-card" role="dialog" aria-modal="true" aria-label="Search">
        <SearchBox autoFocus large onDone={close} />
      </div>
    </div>
  );
}

export function App({
  model,
  source,
  reimport,
}: {
  model: Model;
  source: DataSource;
  reimport: (() => void) | null;
}) {
  const loc = useLocation();
  const [remembered, setRemembered] = useState<Settings>(rememberedSettings);
  const settings = useMemo<Settings>(
    () => ({ ...remembered, ...loc.settings }),
    [remembered, loc.settings],
  );
  const scope = useMemo(
    () => ({ players: settings.players, hideUnused: !settings.showUnused }),
    [settings.players, settings.showUnused],
  );
  const [searching, setSearching] = useState(false);

  const services: AppServices = {
    model,
    source,
    settings,
    scope,
    reimport,
    go: (route, replace = false) => navigate(route, settings, replace),
    setSettings: (patch) => {
      const next = { ...settings, ...patch };
      setRemembered(next);
      rememberSettings(next);
      navigate(loc.route, next, true);
    },
    openSearch: () => setSearching(true),
  };

  useEffect(() => {
    document.title = pageTitle(model, loc.route);
  }, [model, loc.route]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement;
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const route = loc.route;
  // Which header link the page belongs under.
  const section =
    route.page === 'item' || route.page === 'items'
      ? 'items'
      : route.page === 'enemy' || route.page === 'enemies'
        ? 'enemies'
        : route.page === 'calculator'
          ? 'calculators'
          : route.page;
  return (
    <AppContext.Provider value={services}>
      <div class="shell">
        <header class="app-header">
          <Link to={routes.home()} class="brand" aria-label="DigiAtlas home">
            <img src={logoUrl} alt="" width={26} height={26} />
            <span class="brand-text">
              DigiAtlas
              {model.raw.manifest.mod && (
                <small
                  class="mod-badge"
                  title={[
                    model.raw.manifest.mod.options.betterLoot && 'Better Loot',
                    model.raw.manifest.mod.options.fourPlayerSpawns && 'Four-player spawns',
                    model.raw.manifest.mod.options.randomCrownColours && 'Random crown colours',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  Crown Mod v{model.raw.manifest.mod.version}
                </small>
              )}
            </span>
          </Link>
          <nav class="main-nav" aria-label="Sections">
            <Link to={routes.home()} aria-current={section === 'home' ? 'page' : undefined}>
              Home
            </Link>
            <Link to={routes.map(null)} aria-current={section === 'map' ? 'page' : undefined}>
              Maps
            </Link>
            <Link to={routes.items()} aria-current={section === 'items' ? 'page' : undefined}>
              Items
            </Link>
            <Link to={routes.enemies()} aria-current={section === 'enemies' ? 'page' : undefined}>
              Enemies
            </Link>
            <Link
              to={routes.calculators()}
              aria-current={section === 'calculators' ? 'page' : undefined}
            >
              Calculators
            </Link>
          </nav>
          <UpdateCenter />
          <button
            type="button"
            class="search-trigger"
            aria-label="Search items, enemies and rooms"
            onClick={() => setSearching(true)}
          >
            <span>Search items, enemies, rooms</span>
            <kbd>/</kbd>
          </button>
        </header>
        <div class="content">
          {route.page === 'home' && <Home />}
          {route.page === 'calculators' && <Calculators />}
          {route.page === 'calculator' &&
            (route.calculator === 'attack-damage' ? (
              <WeaponDamageCalculator />
            ) : (
              <PowerCalculator
                key={route.calculator}
                kind={route.calculator === 'power-up' ? 'up' : 'down'}
              />
            ))}
          {route.page === 'search' && <SearchPage q={route.q} category={route.category} />}
          {route.page === 'item' && <ItemPage itemKey={route.key} tab={route.tab} />}
          {route.page === 'enemy' && <EnemyPage name={route.name} tab={route.tab} />}
          {route.page === 'items' && (
            <ItemsTable category={route.category} q={route.q} sort={route.sort} />
          )}
          {route.page === 'enemies' && (
            <EnemiesTable kind={route.kind} q={route.q} sort={route.sort} view={route.view} />
          )}
          {route.page === 'map' && (
            <MapPage stageId={route.stageId} selection={route.selection} zoom={route.zoom} />
          )}
        </div>
        {searching && <SearchOverlay close={() => setSearching(false)} />}
      </div>
    </AppContext.Provider>
  );
}
