import { useMemo } from 'preact/hooks';
import { routes, type Sort } from '../app/route';
import { categoryLabel, formatPercent, itemKey, STAT_LABEL, statLabel } from '../data/logic';
import { itemCategories, matchRank, normalize } from '../data/search';
import type { Item } from '../data/types';
import { Link, SettingsBar, settingsText } from './common';
import { useApp } from './context';
import { SortableTable, type Column } from './SortableTable';

interface Row {
  key: string;
  item: Item;
  label: string;
  /** Best chance per kill on the chosen settings, and how many rooms drop it. */
  best: number | null;
  rooms: number;
}

/** A stat gets a column when at least this share of the listed items have it. */
const COLUMN_SHARE = 0.25;
const PRICES = ['buyPrice', 'sellPrice'];
// Stats in the order the game's menus list them; prices last.
const STAT_ORDER = Object.keys(STAT_LABEL).filter((k) => !PRICES.includes(k));

/** Every item, or one category, as a table you can filter and sort. */
export function ItemsTable(props: { category: string | null; q: string; sort: Sort }) {
  const { model, settings, scope, go } = useApp();
  const { category, q, sort } = props;
  const categories = useMemo(() => itemCategories(model), [model]);
  const set = (next: Partial<{ category: string | null; q: string; sort: Sort }>) =>
    go(
      routes.items(
        next.category === undefined ? category : next.category,
        next.q ?? q,
        next.sort ?? (next.category !== undefined ? { column: null, desc: false } : sort),
      ),
      true,
    );

  const rows = useMemo(() => {
    const query = normalize(q);
    const out: Row[] = [];
    for (const item of model.items.values()) {
      if (category && item.category !== category) continue;
      const key = itemKey(item.category, item.id);
      const label = model.itemLabel(key);
      if (query && matchRank(normalize(model.itemSearchText(key)), query) === null) continue;
      const maps = model.mapsFor(key, settings.difficulty, scope);
      out.push({ key, item, label, best: maps[0]?.percent ?? null, rooms: maps.length });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [model, category, q, settings.difficulty, scope]);

  const columns = useMemo(() => {
    const listed = category ? [...model.items.values()].filter((i) => i.category === category) : [];
    const share = (k: string) =>
      listed.filter((i) => i.stats?.[k] !== undefined).length / listed.length;
    const stats = listed.length
      ? [...STAT_ORDER, ...PRICES].filter((k) => share(k) >= COLUMN_SHARE)
      : [];
    const cols: Column<Row>[] = [
      {
        id: 'name',
        label: 'Name',
        value: (r) => r.label,
        render: (r) => <Link to={routes.item(r.key)}>{r.label}</Link>,
      },
    ];
    if (!category)
      cols.push({ id: 'type', label: 'Type', value: (r) => categoryLabel(r.item.category) });
    if (category === 'weapon')
      cols.push({ id: 'skill', label: 'Skill', value: (r) => r.item.skillType ?? null });
    for (const k of stats)
      cols.push({
        id: k,
        label: statLabel(k),
        numeric: true,
        value: (r) => r.item.stats?.[k] ?? null,
        render: (r) =>
          r.item.stats?.[k] !== undefined ? r.item.stats[k].toLocaleString('en-US') : '–',
      });
    cols.push({
      id: 'drop',
      label: 'Best drop',
      title: 'Best chance per kill, and how many rooms drop it',
      numeric: true,
      value: (r) => r.best,
      render: (r) =>
        r.best === null ? (
          <span class="muted">–</span>
        ) : (
          <Link to={routes.item(r.key, 'drops')}>
            {formatPercent(r.best)}
            <span class="muted"> · {r.rooms}</span>
          </Link>
        ),
    });
    return cols;
  }, [model, category]);

  return (
    <div class="page wide">
      <header class="page-head">
        <div class="title-row">
          <h1>{category ? categoryLabel(category) : 'Items'}</h1>
          <SettingsBar unused />
        </div>
        <div class="table-tools">
          <input
            type="search"
            class="page-search"
            aria-label="Filter items"
            placeholder={`Filter ${category ? categoryLabel(category).toLowerCase() : 'items'} by name`}
            value={q}
            onInput={(e) => set({ q: (e.target as HTMLInputElement).value })}
          />
          <span class="muted">
            {rows.length} item{rows.length === 1 ? '' : 's'} · best drop on{' '}
            {settingsText(settings.difficulty, settings.players)}
          </span>
        </div>
        <div class="chips" role="group" aria-label="Item category">
          <button
            type="button"
            class="chip"
            aria-pressed={!category}
            onClick={() => set({ category: null })}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              type="button"
              class="chip"
              aria-pressed={category === c.category}
              onClick={() => set({ category: c.category })}
            >
              {c.label} <span class="chip-count">{c.count}</span>
            </button>
          ))}
        </div>
      </header>
      <SortableTable
        caption={category ? categoryLabel(category) : 'Items'}
        columns={columns}
        rows={rows}
        sort={sort}
        onSort={(s) => set({ sort: s })}
        rowKey={(r) => r.key}
      />
    </div>
  );
}
