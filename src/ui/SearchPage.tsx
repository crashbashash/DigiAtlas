import { useMemo } from 'preact/hooks';
import { routes } from '../app/route';
import { categoryLabel } from '../data/logic';
import { itemCategories, search, type Hit } from '../data/search';
import { Empty, Link } from './common';
import { useApp } from './context';
import { hitRoute } from './SearchBox';

/** Every result for a search, or every item in a category. */
export function SearchPage({ q, category }: { q: string; category: string | null }) {
  const { model, go } = useApp();
  const categories = useMemo(() => itemCategories(model), [model]);
  const results = useMemo(
    () => (q.trim() || category ? search(model, q, category) : null),
    [model, q, category],
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
              <Link to={hitRoute(hit)}>{hit.label}</Link>
              <span class="muted">{hit.detail}</span>
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div class="page search-page">
      <header class="page-head">
        <h1>{category && !q ? categoryLabel(category) : 'Search'}</h1>
        <input
          type="search"
          class="page-search"
          aria-label="Search"
          placeholder={
            category
              ? `Filter ${categoryLabel(category).toLowerCase()}`
              : 'Search items, enemies and rooms'
          }
          value={q}
          autoFocus
          onInput={(e) => set({ q: (e.target as HTMLInputElement).value })}
        />
        <div class="chips" role="group" aria-label="Item category">
          <button
            type="button"
            class="chip"
            aria-pressed={!category}
            onClick={() => set({ category: null })}
          >
            Everything
          </button>
          {categories.map((c) => (
            <button
              type="button"
              class="chip"
              aria-pressed={category === c.category}
              onClick={() => set({ category: c.category })}
            >
              {c.label}
            </button>
          ))}
        </div>
      </header>
      {!results && <Empty>Type at least two letters, or pick a category.</Empty>}
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
