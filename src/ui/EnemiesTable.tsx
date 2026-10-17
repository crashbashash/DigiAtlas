import { useMemo } from 'preact/hooks';
import { routes, type EnemyKindFilter, type EnemyView, type Sort } from '../app/route';
import { matchRank, normalize } from '../data/search';
import type { Enemy, EnemyKind } from '../data/types';
import { KindDot, Link, Segmented, SettingsBar, settingsText } from './common';
import { useApp } from './context';
import { range } from './pieces';
import { SortableTable, type Column } from './SortableTable';

interface Row {
  name: string;
  kind: EnemyKind;
  variants: Enemy[];
  rooms: number;
}

const STATS: [string, string, (e: Enemy) => number][] = [
  ['hp', 'HP', (e) => e.hp],
  ['strength', 'Str', (e) => e.stats.strength],
  ['defense', 'Def', (e) => e.stats.defense],
  ['wisdom', 'Wis', (e) => e.stats.wisdom],
  ['spirit', 'Spi', (e) => e.stats.spirit],
  ['speed', 'Spd', (e) => e.stats.speed],
  ['exp', 'EXP', (e) => e.stats.exp],
];
const RESISTS: [string, string, (e: Enemy) => number][] = [
  ['fire', 'Fire', (e) => e.resist.fire],
  ['ice', 'Ice', (e) => e.resist.ice],
  ['thunder', 'Thunder', (e) => e.resist.thunder],
  ['dark', 'Dark', (e) => e.resist.dark],
  ['stun', 'Stun', (e) => e.resist.stun],
  ['poison', 'Poison', (e) => e.resist.poison],
];
const LONG: Record<string, string> = {
  strength: 'Strength',
  defense: 'Defense',
  wisdom: 'Wisdom',
  spirit: 'Spirit',
  speed: 'Speed',
};

/** Every enemy and boss, one row per name, with its stats or resistances on the chosen difficulty. */
export function EnemiesTable(props: {
  kind: EnemyKindFilter;
  q: string;
  sort: Sort;
  view: EnemyView;
}) {
  const { model, settings, scope, go } = useApp();
  const { kind, q, sort, view } = props;
  const set = (next: Partial<{ kind: EnemyKindFilter; q: string; sort: Sort; view: EnemyView }>) =>
    go(routes.enemies(next.kind ?? kind, next.q ?? q, next.sort ?? sort, next.view ?? view), true);

  const rows = useMemo(() => {
    const query = normalize(q);
    const names = new Map<string, EnemyKind>();
    // A boss's parts (Lucemon's orbs) are listed on its page, not as enemies of their own.
    for (const e of model.enemies.values())
      if (e.kind !== 'object' && !model.isPartOnly(e.name))
        names.set(e.name, model.speciesKind(e.name));
    const out: Row[] = [];
    for (const [name, k] of names) {
      if (kind !== 'all' && k !== kind) continue;
      if (query && matchRank(normalize(name), query) === null) continue;
      out.push({
        name,
        kind: k,
        variants: model.variantsOn(name, settings.difficulty, scope),
        rooms: model.spawnsOf(name, settings.difficulty, scope).length,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [model, kind, q, settings.difficulty, scope]);

  const columns = useMemo(() => {
    const cols: Column<Row>[] = [
      {
        id: 'name',
        label: 'Name',
        value: (r) => r.name,
        render: (r) => (
          <Link to={routes.enemy(r.name)} class="name-cell">
            <KindDot kind={r.kind} />
            {r.name}
          </Link>
        ),
      },
      {
        id: 'variants',
        label: 'Variants',
        title: 'Stat variants (area tiers and crown ranks) that spawn on this difficulty',
        numeric: true,
        value: (r) => r.variants.length,
      },
    ];
    // A range when the variants differ; sorting uses the strongest.
    for (const [id, label, pick] of view === 'stats' ? STATS : RESISTS)
      cols.push({
        id,
        label,
        title: LONG[id],
        numeric: true,
        value: (r) => Math.max(...r.variants.map(pick)),
        render: (r) => range(r.variants.map(pick)),
      });
    cols.push({
      id: 'rooms',
      label: 'Rooms',
      title: 'Rooms it spawns in on this difficulty',
      numeric: true,
      value: (r) => r.rooms || null,
      render: (r) =>
        r.rooms ? (
          <Link to={routes.enemy(r.name, 'spawns')}>{r.rooms}</Link>
        ) : (
          <span class="muted">–</span>
        ),
    });
    return cols;
  }, [view]);

  return (
    <div class="page wide">
      <header class="page-head">
        <div class="title-row">
          <h1>{kind === 'boss' ? 'Bosses' : 'Enemies'}</h1>
          <SettingsBar unused />
        </div>
        <div class="table-tools">
          <input
            type="search"
            class="page-search"
            aria-label="Filter enemies"
            placeholder="Filter by name"
            value={q}
            onInput={(e) => set({ q: (e.target as HTMLInputElement).value })}
          />
          <Segmented
            label="Which enemies"
            value={kind}
            options={[
              { value: 'all', label: 'All' },
              { value: 'enemy', label: 'Enemies' },
              { value: 'boss', label: 'Bosses' },
            ]}
            onChange={(k) => set({ kind: k })}
          />
          <Segmented
            label="Columns"
            value={view}
            options={[
              { value: 'stats', label: 'Stats' },
              { value: 'resist', label: 'Resistances' },
            ]}
            onChange={(v) => set({ view: v })}
          />
        </div>
        <p class="note">
          {rows.length}{' '}
          {kind === 'boss'
            ? rows.length === 1
              ? 'boss'
              : 'bosses'
            : rows.length === 1
              ? 'enemy'
              : 'enemies'}{' '}
          · stats of the variants that spawn on{' '}
          {settingsText(settings.difficulty, settings.players)} (a range when they differ; enemies
          that spawn nowhere on it show all their variants).
        </p>
      </header>
      <SortableTable
        caption={kind === 'boss' ? 'Bosses' : 'Enemies'}
        columns={columns}
        rows={rows}
        sort={sort}
        onSort={(s) => set({ sort: s })}
        rowKey={(r) => r.name}
      />
    </div>
  );
}
