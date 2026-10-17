import { useMemo } from 'preact/hooks';
import { lastMap } from '../app/navigation';
import { routes } from '../app/route';
import { featuredEnemies, itemCategories } from '../data/search';
import { Link } from './common';
import { useApp } from './context';
import logoUrl from './logo.svg';
import { SearchBox } from './SearchBox';

/** The landing page: search for anything, or start from one of the sections. */
export function Home() {
  const { model, scope, reimport } = useApp();
  const recent = lastMap();
  const recentStage = recent ? model.byId.get(recent) : undefined;
  const categories = useMemo(() => itemCategories(model), [model]);
  const enemies = useMemo(() => featuredEnemies(model, 4, scope), [model, scope]);
  const m = model.raw.manifest;

  return (
    <div class="home">
      <section class="hero">
        <img class="hero-logo" src={logoUrl} alt="" width={64} height={64} />
        <h1>DigiAtlas</h1>
        <p class="tagline">
          Digimon World 4 at a glance: where items drop and how often, what spawns where, and the
          stats behind it.
        </p>
        <SearchBox
          large
          autoFocus
          placeholder="Search an item, enemy or room, for example Long Sword or Goburimon"
        />
        {recentStage && (
          <p class="continue">
            Continue on <Link to={routes.map(recentStage.id)}>{model.stageTitle(recentStage)}</Link>
            {recentStage.area && <span class="muted"> · {recentStage.area}</span>}
          </p>
        )}
      </section>

      <div class="sections">
        <section class="section-card">
          <h2>Maps and spawns</h2>
          <p class="muted">Every room with its enemies, boxes, traders and what drops there.</p>
          <ul class="link-list">
            {model.worlds.map((w) => (
              <li>
                <Link to={routes.map(w.rooms[0].stages[0].id)}>{w.area}</Link>
                <span class="muted">{w.rooms.length} rooms</span>
              </li>
            ))}
          </ul>
        </section>

        <section class="section-card">
          <h2>Items</h2>
          <p class="muted">Stats, the best places to farm them, trades and appraisal.</p>
          <ul class="link-list">
            {categories.map((c) => (
              <li>
                <Link to={routes.items(c.category)}>{c.label}</Link>
                <span class="muted">{c.count}</span>
              </li>
            ))}
          </ul>
          <p class="card-more">
            <Link to={routes.items()}>Every item, sortable by stats and drop chance →</Link>
          </p>
        </section>

        <section class="section-card">
          <h2>Enemies</h2>
          <p class="muted">
            Stats, resistances and where each one appears. Search any enemy by name.
          </p>
          <ul class="link-list">
            {enemies.map((e) => (
              <li key={e.name}>
                <Link to={routes.enemy(e.name)}>{e.name}</Link>
                <span class="muted">{e.kind === 'boss' ? 'Boss' : e.area}</span>
              </li>
            ))}
          </ul>
          <p class="card-more">
            <Link to={routes.enemies()}>Every enemy, sortable by stats →</Link>
          </p>
        </section>

        <section class="section-card planned">
          <h2>Calculators</h2>
          <p class="muted">
            Damage, buffs and debuffs, worked out from the game's own formulas. Planned.
          </p>
        </section>
      </div>

      <footer class="home-footer muted">
        Data from your {m.region.toUpperCase()} {m.platform.toUpperCase()} disc
        {m.serial ? ` (${m.serial})` : ''}
        {reimport && (
          <>
            {' · '}
            <button type="button" class="link" onClick={reimport}>
              Re-import from disc
            </button>
          </>
        )}
      </footer>
    </div>
  );
}
