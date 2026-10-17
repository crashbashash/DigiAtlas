import { useMemo, useRef, useState } from 'preact/hooks';
import { lastMap } from '../app/navigation';
import { formatHash, routes, type Route } from '../app/route';
import { search, type Hit } from '../data/search';
import { useApp } from './context';

const GROUPS: { key: 'items' | 'enemies' | 'rooms'; title: string }[] = [
  { key: 'items', title: 'Items' },
  { key: 'enemies', title: 'Enemies' },
  { key: 'rooms', title: 'Rooms' },
];
const PER_GROUP = 6;

/** Where a search result leads. Enemies open on the map, on the stage you were last looking at. */
export function hitRoute(hit: Hit): Route {
  if (hit.kind === 'item') return routes.item(hit.id);
  if (hit.kind === 'room') return routes.map(hit.id);
  return routes.map(lastMap(), { kind: 'species', name: hit.id });
}

let nextId = 0;

/**
 * Search box with results grouped by kind. Arrow keys move through the results and Enter opens
 * the highlighted one (the first by default).
 */
export function SearchBox(props: {
  autoFocus?: boolean;
  large?: boolean;
  onDone?(): void;
  placeholder?: string;
}) {
  const { model, settings, go } = useApp();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useRef(`search-${nextId++}`).current;
  const results = useMemo(
    () => (query.trim().length >= 2 ? search(model, query) : null),
    [model, query],
  );
  const shown = GROUPS.map((g) => ({
    ...g,
    hits: results ? results[g.key].slice(0, PER_GROUP) : [],
  }));
  const flat = shown.flatMap((g) => g.hits);
  const total = results ? results.items.length + results.enemies.length + results.rooms.length : 0;
  const open = (route: Route) => {
    go(route);
    props.onDone?.();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      const hit = flat[active] ?? flat[0];
      if (hit) open(hitRoute(hit));
      else if (query.trim()) open(routes.search(query.trim()));
    }
  };

  let index = -1;
  return (
    <div class={`searchbox${props.large ? ' large' : ''}`}>
      <input
        type="search"
        role="combobox"
        aria-expanded={!!results}
        aria-controls={listId}
        aria-activedescendant={flat.length ? `${listId}-${active}` : undefined}
        aria-label="Search items, enemies and rooms"
        placeholder={props.placeholder ?? 'Search items, enemies and rooms'}
        spellcheck={false}
        autoFocus={props.autoFocus}
        value={query}
        onInput={(e) => {
          setQuery((e.target as HTMLInputElement).value);
          setActive(0);
        }}
        onKeyDown={onKey}
      />
      {results && (
        <div class="search-results" id={listId} role="listbox" aria-label="Search results">
          {!total && <p class="empty">No matches for “{query.trim()}”.</p>}
          {shown.map(
            (g) =>
              g.hits.length > 0 && (
                <div class="search-group" role="group" aria-label={g.title}>
                  <div class="sub">
                    {g.title}
                    {results[g.key].length > g.hits.length && (
                      <span> · {results[g.key].length}</span>
                    )}
                  </div>
                  {g.hits.map((hit) => {
                    index += 1;
                    const i = index;
                    const route = hitRoute(hit);
                    return (
                      <a
                        id={`${listId}-${i}`}
                        role="option"
                        aria-selected={i === active}
                        class={`hit${i === active ? ' active' : ''}`}
                        href={formatHash(route, settings)}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => props.onDone?.()}
                      >
                        <span class="hit-label">{hit.label}</span>
                        <span class="muted">{hit.detail}</span>
                      </a>
                    );
                  })}
                </div>
              ),
          )}
          {total > flat.length && (
            <a
              class="see-all"
              href={formatHash(routes.search(query.trim()), settings)}
              onClick={() => props.onDone?.()}
            >
              See all {total} results
            </a>
          )}
        </div>
      )}
    </div>
  );
}
