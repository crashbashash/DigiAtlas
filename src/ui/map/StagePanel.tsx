import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { routes, type MapSelection } from '../../app/route';
import {
  fillModeText,
  formatPercent,
  groupByEnemy,
  itemKey,
  scriptRefText,
  startModeText,
  type EnemyGroup,
} from '../../data/logic';
import { traderLabel } from '../../data/model';
import {
  DIFFICULTY_LABEL,
  type Difficulty,
  type Enemy,
  type Generator,
  type Stage,
} from '../../data/types';
import { Empty, KindDot, Link, settingsText } from '../common';
import { useApp } from '../context';
import { KIND_LABEL } from '../mapview';
import { DropTableView, EnemyStats, ItemLink, variantLabel } from '../pieces';

const fmt = (n: number): string => n.toLocaleString('en-US');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A selection after the spawner's name has been matched to its index on this difficulty. */
export type Resolved =
  | { kind: 'none' }
  | { kind: 'generator'; index: number }
  | { kind: 'group'; row: number }
  | { kind: 'item'; key: string }
  | { kind: 'species'; name: string };

export interface PanelProps {
  stage: Stage;
  difficulty: Difficulty;
  selection: Resolved;
  /** Spawners on this stage that drop the selected item. */
  itemSpawners: number;
  /** A trader pin that was clicked: open its list. `n` changes on every click so the same pin can flash again. */
  reveal: { index: number; n: number } | null;
  select(sel: MapSelection): void;
}

/** The right-hand panel of the map page: the stage overview, or whatever is selected on it. */
export function StagePanel(props: PanelProps) {
  const { stage, selection: sel } = props;
  const scroller = useRef<HTMLElement>(null);
  const identity = `${stage.id}|${JSON.stringify(sel)}`;
  // Back to the top for a new stage or selection, not when a setting changes underneath.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [identity]);

  return (
    <aside class="panel" ref={scroller} aria-label="Details">
      {sel.kind === 'item' && <ItemBanner {...props} itemKey={sel.key} />}
      {sel.kind === 'generator' && <SpawnerView {...props} index={sel.index} />}
      {sel.kind === 'group' && <GroupView {...props} row={sel.row} />}
      {sel.kind === 'species' && <SpeciesView {...props} name={sel.name} />}
      {(sel.kind === 'none' || sel.kind === 'item') && <Overview {...props} />}
    </aside>
  );
}

function Back({
  select,
  label = 'Stage overview',
}: {
  select: PanelProps['select'];
  label?: string;
}) {
  return (
    <button type="button" class="link back" onClick={() => select({ kind: 'none' })}>
      ← {label}
    </button>
  );
}

function Title({ enemy, fallback }: { enemy: Enemy | undefined; fallback: string }) {
  const kind = enemy?.kind ?? 'enemy';
  return (
    <>
      <h2>
        <KindDot kind={kind} />
        {enemy?.name ?? fallback}
        <small>{KIND_LABEL[kind]}</small>
      </h2>
      {enemy && kind !== 'object' && (
        <p class="to-page">
          <Link to={routes.enemy(enemy.name)}>Enemy page: every room, all drops →</Link>
        </p>
      )}
    </>
  );
}

// --- item ------------------------------------------------------------------------------------

/** What the selected item has to do with this stage, and where to go if the answer is nothing. */
function ItemBanner({
  stage,
  difficulty: d,
  itemKey: key,
  itemSpawners,
  select,
}: PanelProps & { itemKey: string }) {
  const { model, settings, scope } = useApp();
  const here = useMemo(
    () => model.sourcesOf(key, d, scope).filter((s) => s.stage.id === stage.id),
    [model, key, d, scope, stage.id],
  );
  const traders = model
    .tradersAt(stage, d)
    .filter((t) =>
      (t.tables[d] ?? []).some((o) =>
        [o.give, o.get].some((x) => itemKey(x.category, x.id) === key),
      ),
    );
  const best = useMemo(
    () => model.mapsFor(key, d, scope).find((m) => m.stage.id !== stage.id),
    [model, key, d, scope, stage.id],
  );
  const names = [...new Set(here.map((s) => s.enemyName))];
  const bestHere = Math.max(0, ...here.map((s) => s.percent));
  return (
    <section class="item-banner" aria-label="Selected item">
      <div class="item-banner-head">
        <div>
          <div class="sub">Showing on the map</div>
          <strong>
            <ItemLink itemKey={key} />
          </strong>
        </div>
        <button
          type="button"
          class="icon"
          title="Clear (Esc)"
          aria-label="Clear the item"
          onClick={() => select({ kind: 'none' })}
        >
          ×
        </button>
      </div>
      {itemSpawners > 0 ? (
        <p>
          Dropped here by {names.join(', ')}, best <strong>{formatPercent(bestHere)}</strong> per
          kill ({plural(itemSpawners, 'spawner')} highlighted).
        </p>
      ) : (
        <p>Nothing drops it in this room on {settingsText(d, settings.players)}.</p>
      )}
      {traders.length > 0 && (
        <p>{plural(traders.length, 'trader')} here deal in it (highlighted pins).</p>
      )}
      {itemSpawners === 0 && best && (
        <p>
          Best chance elsewhere:{' '}
          <Link to={routes.map(best.stage.id, { kind: 'item', key }, true)}>
            {model.stageTitle(best.stage)}
          </Link>
          , {formatPercent(best.percent)}.
        </p>
      )}
      <p class="item-banner-actions">
        <Link to={routes.item(key, 'drops')}>Every place it drops</Link>
        <Link to={routes.item(key)}>Item details</Link>
      </p>
    </section>
  );
}

// --- overview --------------------------------------------------------------------------------

/** Spawn groups of one enemy name: crown ranks and area tiers share a name and are one row here. */
interface Species {
  name: string;
  enemy: Enemy | undefined;
  groups: EnemyGroup[];
}

function bySpecies(groups: EnemyGroup[]): Species[] {
  const out = new Map<string, Species>();
  for (const g of groups) {
    const name = g.enemy?.name ?? `Row ${g.row}`;
    const s = out.get(name);
    if (s) s.groups.push(g);
    else out.set(name, { name, enemy: g.enemy, groups: [g] });
  }
  for (const s of out.values()) s.groups.sort((a, b) => (a.enemy?.hp ?? 0) - (b.enemy?.hp ?? 0));
  return [...out.values()].sort(
    (a, b) =>
      Number(b.enemy?.kind === 'boss') - Number(a.enemy?.kind === 'boss') ||
      a.name.localeCompare(b.name),
  );
}

function groupDetail(g: EnemyGroup): string {
  if (g.enemy?.kind === 'object') return `${g.spawners} placed`;
  const label = g.enemy?.form ?? (g.enemy?.rarity ? `crown ${g.enemy.rarity}` : '');
  const hp = g.enemy ? `HP ${fmt(g.enemy.hp)}${label ? ` · ${label}` : ''} · ` : '';
  const part = g.enemy?.role === 'part' ? `Part of ${g.enemy.partOf} · ` : '';
  return `${part}${hp}${plural(g.spawners, 'spawner')} · ${g.total} total`;
}

function SpeciesRow({ s, select }: { s: Species; select: PanelProps['select'] }) {
  const [open, setOpen] = useState(false);
  const kind = s.enemy?.kind ?? 'enemy';
  if (s.groups.length === 1) {
    const g = s.groups[0];
    return (
      <button type="button" class="row" onClick={() => select({ kind: 'group', row: g.row })}>
        <KindDot kind={kind} />
        <span class="grow">{s.name}</span>
        <span class="detail muted">{groupDetail(g)}</span>
      </button>
    );
  }
  const hps = s.groups.map((g) => g.enemy?.hp ?? 0);
  const spawners = s.groups.reduce((n, g) => n + g.spawners, 0);
  const total = s.groups.reduce((n, g) => n + g.total, 0);
  return (
    <div class="species">
      <div class="species-head">
        <button type="button" class="row" onClick={() => select({ kind: 'species', name: s.name })}>
          <KindDot kind={kind} />
          <span class="grow">{s.name}</span>
          <span class="detail muted">
            {s.groups.length} variants · HP {fmt(Math.min(...hps))}–{fmt(Math.max(...hps))} ·{' '}
            {plural(spawners, 'spawner')} · {total} total
          </span>
        </button>
        <button
          type="button"
          class="expand"
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} ${s.name} variants`}
          onClick={() => setOpen(!open)}
        >
          {open ? '▾' : '▸'}
        </button>
      </div>
      {open && (
        <div class="variants">
          {s.groups.map((g) => (
            <button type="button" class="row" onClick={() => select({ kind: 'group', row: g.row })}>
              <span class="grow">{g.enemy ? variantLabel(g.enemy) : 'Base'}</span>
              <span class="detail muted">{groupDetail(g)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Overview({ stage, difficulty: d, reveal, select }: PanelProps) {
  const { model, scope, setSettings } = useApp();
  const gens = model.generators(stage, d, scope);
  const hidden = model.hidden(stage, d, scope);
  const species = bySpecies(groupByEnemy(gens, model.enemies, hidden));
  const fights = species.filter((s) => s.enemy?.kind !== 'object');
  const objects = species.filter((s) => s.enemy?.kind === 'object');
  return (
    <>
      {model.tradersAt(stage, d).length > 0 && (
        <Traders stage={stage} difficulty={d} reveal={reveal} />
      )}
      {!gens.length ? (
        <p class="note">No enemies or breakable objects spawn here.</p>
      ) : (
        <>
          <h3 class="sub">Enemies ({fights.length})</h3>
          <div class="list">
            {fights.map((s) => (
              <SpeciesRow s={s} select={select} />
            ))}
          </div>
          {objects.length > 0 && (
            <>
              <h3 class="sub">Boxes, barrels and crates ({objects.length})</h3>
              <div class="list">
                {objects.map((s) => (
                  <SpeciesRow s={s} select={select} />
                ))}
              </div>
            </>
          )}
          <p class="note">
            Markers show every enemy spawn in the stage. Some only appear after game events such as
            traps, cutscenes or story progress.
          </p>
          {hidden.size > 0 && (
            <p class="note">
              {hidden.size} spawner{hidden.size === 1 ? ' is' : 's are'} left out because no game
              script starts {hidden.size === 1 ? 'it' : 'them'}.{' '}
              <button type="button" class="link" onClick={() => setSettings({ showUnused: true })}>
                Show them
              </button>
            </p>
          )}
        </>
      )}
      {!stage.map && (
        <p class="note">No map is available for this stage; markers are plotted on a plain grid.</p>
      )}
    </>
  );
}

/** The Digimon in a shop room and what each one swaps on the chosen difficulty. */
function Traders({
  stage,
  difficulty: d,
  reveal,
}: {
  stage: Stage;
  difficulty: Difficulty;
  reveal: PanelProps['reveal'];
}) {
  const { model } = useApp();
  const traders = model.tradersAt(stage, d);
  const total = traders.reduce((n, t) => n + (t.tables[d]?.length ?? 0), 0);
  const refs = useRef<(HTMLDetailsElement | null)[]>([]);
  useEffect(() => {
    if (!reveal) return;
    const el = refs.current[reveal.index];
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ block: 'nearest' });
    el.classList.remove('flash');
    void el.offsetWidth; // restart the animation
    el.classList.add('flash');
  }, [reveal]);
  return (
    <>
      <h3 class="sub">
        Traders ({traders.length}) · {total} trades
      </h3>
      <p class="note">
        Hand a trader the item on the left and they give you the one on the right. Each stands where
        its pin is on the map; what it swaps depends on the difficulty ({DIFFICULTY_LABEL[d]} is
        shown).
      </p>
      {traders.map((t, i) => (
        <details
          class="trader"
          ref={(el) => {
            refs.current[i] = el;
          }}
        >
          <summary>
            {traderLabel(t)}
            <span class="muted"> · {t.tables[d]!.length} trades</span>
          </summary>
          <div class="list">
            {t.tables[d]!.map((o) => (
              <div class="trade">
                <ItemLink itemKey={itemKey(o.give.category, o.give.id)} />
                <span class="arrow muted">→</span>
                <ItemLink itemKey={itemKey(o.get.category, o.get.id)} />
              </div>
            ))}
          </div>
        </details>
      ))}
    </>
  );
}

// --- spawners and enemies ----------------------------------------------------------------------

/** What makes a spawner start, from its trigger circle and the stage's scripts. */
function StartBlock({ g }: { g: Generator }) {
  const info = g.script;
  const lines: string[] = [];
  if (g.trigger) {
    lines.push(`Starts by itself when you get within ${g.trigger.radius} units of its anchor.`);
  } else if (g.startMode === 'direct' || g.startMode === 'timer') {
    if (!info || info.status === 'referenced') lines.push('Started by a game script:');
    else if (info.status === 'none')
      lines.push('No script in this stage starts it, so it most likely never appears.');
    else if (info.status === 'dynamic')
      lines.push(
        'A script starts spawners in a loop by building their names, and this one fits the pattern:',
      );
    else
      lines.push(
        'A script in this stage starts spawners by a name it builds in code, so it cannot be told whether this one is started.',
      );
  }
  const refs = info?.refs ?? [];
  if (g.trigger && refs.length) lines.push('Scripts also control it:');
  return (
    <div class="starts">
      <h3 class="sub">What starts it</h3>
      {lines.map((t) => (
        <p class="note tight">{t}</p>
      ))}
      {refs.length > 0 && (
        <ul>
          {refs.map((r) => (
            <li>{scriptRefText(r)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SpawnerView({ stage, difficulty: d, index, select }: PanelProps & { index: number }) {
  const { model, scope } = useApp();
  const g = model.generators(stage, d, scope)[index];
  if (!g) return <Back select={select} />;
  const e = model.enemies.get(g.row);
  const table = model.tableFor(g, d);
  const last = model.tableFor(g, d, true);
  const isObject = e?.kind === 'object';
  const fact = (k: string, v: string) => (
    <div>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
  return (
    <>
      <Back select={select} />
      <Title enemy={e} fallback={`Unknown (row ${g.row})`} />
      <dl class="facts">
        {fact(isObject ? 'Placed at' : 'Spots', `${g.spawns.length}`)}
        {!isObject && fact('Total spawned', g.count === null ? '?' : `${g.count}`)}
        {!isObject && fact('At once (max)', g.maxCount === null ? '?' : `${g.maxCount}`)}
      </dl>
      {!isObject && (
        <p class="note">
          {startModeText(g.startMode)}.
          {(g.count ?? 0) > (g.maxCount ?? 0) && ` ${fillModeText(g.fillMode)}.`}
          {g.count !== null &&
            g.spawns.length > g.count &&
            ` It has ${g.spawns.length} spots in its list and places its first ${g.count}, in order.`}
        </p>
      )}
      {!isObject && <StartBlock g={g} />}
      <h3 class="sub">Stats ({DIFFICULTY_LABEL[d]})</h3>
      {e ? <EnemyStats enemy={e} /> : <p class="muted">No stat data for row {g.row}.</p>}
      <DropTableView table={table} caption={`Drops (${DIFFICULTY_LABEL[d]}, per kill)`} />
      {last.rows.length > 0 && JSON.stringify(last.rows) !== JSON.stringify(table.rows) && (
        <DropTableView table={last} caption="When it is the last one defeated" />
      )}
    </>
  );
}

function GroupView({ stage, difficulty: d, row, select }: PanelProps & { row: number }) {
  const { model, scope } = useApp();
  const gens = model.generators(stage, d, scope);
  const e = model.enemies.get(row);
  const group = groupByEnemy(gens, model.enemies, model.hidden(stage, d, scope)).find(
    (x) => x.row === row,
  );
  // Spawners of one kind usually share a drop table; show each distinct one once.
  const tables = new Map<string, Generator>();
  for (const gi of group?.generators ?? []) {
    const name = gens[gi].drops?.[d] ?? '';
    if (!tables.has(name)) tables.set(name, gens[gi]);
  }
  return (
    <>
      <Back select={select} />
      <Title enemy={e} fallback={`Unknown (row ${row})`} />
      {group && (
        <p class="note">
          {e?.kind === 'object'
            ? `${group.spawners} placed in this stage.`
            : `${plural(group.spawners, 'spawner')} at ${plural(group.points, 'point')}, ${group.total} spawned in total.`}
        </p>
      )}
      <h3 class="sub">Stats ({DIFFICULTY_LABEL[d]})</h3>
      {e ? <EnemyStats enemy={e} /> : <p class="muted">No stat data for row {row}.</p>}
      {[...tables.values()].map((g) => (
        <DropTableView
          table={model.tableFor(g, d)}
          caption={`Drops (${DIFFICULTY_LABEL[d]}, per kill)`}
        />
      ))}
    </>
  );
}

function SpeciesView({ difficulty: d, name, select }: PanelProps & { name: string }) {
  const { model, scope } = useApp();
  const rows = [...model.enemies.values()].filter((e) => e.name === name);
  const kind = rows[0]?.kind ?? 'enemy';
  const rowSet = new Set(rows.map((r) => r.row));
  const found = model.stages
    .map((s) => {
      const hidden = model.hidden(s, d, scope);
      return {
        s,
        gens: model.generators(s, d, scope).filter((g, i) => rowSet.has(g.row) && !hidden.has(i)),
      };
    })
    .filter((x) => x.gens.length > 0);
  // Which stat rows this enemy actually uses on this difficulty, weakest first.
  const used = new Map<number, number>();
  for (const { gens } of found) for (const g of gens) used.set(g.row, (used.get(g.row) ?? 0) + 1);
  const variants = [...used.keys()]
    .map((r) => model.enemies.get(r)!)
    .filter(Boolean)
    .sort((a, b) => a.hp - b.hp);
  if (!rows.length) return <Empty>No enemy is called {name}.</Empty>;
  return (
    <>
      <Back select={select} label="Back" />
      <h2>
        <KindDot kind={kind} />
        {name}
        <small>{KIND_LABEL[kind]}</small>
      </h2>
      <p class="to-page">
        <Link to={routes.enemy(name)}>Enemy page: every room, all drops →</Link>
      </p>
      {variants.length > 0 && (
        <>
          <h3 class="sub">Stats ({DIFFICULTY_LABEL[d]})</h3>
          <div class="table-scroll">
            <table class="variants">
              <thead>
                <tr>
                  <th class="l">Variant</th>
                  {['HP', 'Str', 'Def', 'Wis', 'Spi', 'Spd', 'EXP'].map((c) => (
                    <th>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {variants.map((e) => (
                  <tr>
                    <td class="l">
                      {variantLabel(e)}
                      <span class="muted"> ×{used.get(e.row)}</span>
                    </td>
                    {[
                      e.hp,
                      e.stats.strength,
                      e.stats.defense,
                      e.stats.wisdom,
                      e.stats.spirit,
                      e.stats.speed,
                      e.stats.exp,
                    ].map((n) => (
                      <td class="n">{fmt(n)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {variants.length > 1 && (
            <p class="note">
              {variants.length} stat variants appear (area tiers and crown ranks). Click a marker
              for the exact one, resistances included.
            </p>
          )}
        </>
      )}
      <h3 class="sub">Found in ({DIFFICULTY_LABEL[d]})</h3>
      {!found.length && <p class="muted">Not spawned anywhere on this difficulty.</p>}
      <div class="list">
        {found.map(({ s, gens }) => (
          <Link to={routes.map(s.id, { kind: 'species', name })} class="row">
            <span class="grow">{model.stageTitle(s)}</span>
            <span class="detail muted">
              {plural(gens.length, 'spawner')} · {gens.reduce((n, g) => n + (g.count ?? 0), 0)}{' '}
              total
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
