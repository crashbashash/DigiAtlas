import { ItemName } from './ItemName';
import { useMemo } from 'preact/hooks';
import { routes } from '../app/route';
import { categoryLabel } from '../data/logic';
import { search, type Hit } from '../data/search';
import { Empty, Link } from './common';
import { useApp } from './context';
import { hitRoute } from './SearchBox';

/** Every result for a search. Browsing a whole category is the item table's job. */
export function SearchPage({ q, category }: { q: string; category: string | null }) {
  const { model, settings, go } = useApp();
  const results = useMemo(
    () => (q.trim() ? search(model, q, category, settings.difficulty) : null),
    [model, q, category, settings.difficulty],
  );
  const set = (next: { q?: string; category?: string | null }) =>
    go(routes.search(next.q ?? q, next.category === undefined ? category : next.category), true);

  const group = (title: string, hits: Hit[]) =>
    hits.length > 0 && (
      <section class="result-group">
        <h2 class="sub">
          {title} <span class="muted">{hits.length}</span>
        </h2>
        <ul class="result-list">
          {hits.map((hit) => (
            <li>
              <Link to={hitRoute(hit)}>
                {hit.kind === 'item' ? <ItemName itemKey={hit.id} /> : hit.label}
              </Link>
              <span class="muted">{hit.detail}</span>
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div class="page search-page">
      <header class="page-head">
        <h1>Search</h1>
        <input
          type="search"
          class="page-search"
          aria-label="Search"
          placeholder="Search items, enemies and rooms"
          value={q}
          autoFocus
          onInput={(e) => set({ q: (e.target as HTMLInputElement).value })}
        />
        <p class="note">
          {category && (
            <>
              Only {categoryLabel(category).toLowerCase()}.{' '}
              <button type="button" class="link" onClick={() => set({ category: null })}>
                Search everything
              </button>
              {' · '}
            </>
          )}
          Or browse <Link to={routes.items()}>every item</Link> and{' '}
          <Link to={routes.enemies()}>every enemy</Link> as sortable tables.
        </p>
      </header>
      {!results && <Empty>Type a name to search.</Empty>}
      {results && !results.items.length && !results.enemies.length && !results.rooms.length && (
        <Empty>No matches for “{q.trim()}”.</Empty>
      )}
      {results && (
        <div class="results-columns">
          {group('Items', results.items)}
          {group('Enemies', results.enemies)}
          {group('Rooms', results.rooms)}
        </div>
      )}
    </div>
  );
}
