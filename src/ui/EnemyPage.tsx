import { useMemo, useState } from 'preact/hooks';
import { routes, type EnemyTab } from '../app/route';
import { categoryLabel, formatPercent } from '../data/logic';
import type { Model } from '../data/model';
import type { Enemy } from '../data/types';
import { Empty, KindDot, Link, SettingsBar, settingsText } from './common';
import { useApp } from './context';
import { KIND_LABEL } from './mapview';
import { ItemLink, range, variantLabel } from './pieces';

const fmt = (n: number): string => n.toLocaleString('en-US');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** An enemy by name: its stat variants, where it spawns and what it drops. */
export function EnemyPage({ name, tab }: { name: string; tab: EnemyTab }) {
  const { model, settings, scope } = useApp();
  const d = settings.difficulty;
  const rows = useMemo(() => model.speciesRows(name), [model, name]);
  const spawns = useMemo(() => model.spawnsOf(name, d, scope), [model, name, d, scope]);
  const variants = useMemo(() => model.variantsOn(name, d, scope), [model, name, d, scope]);
  const drops = useMemo(() => model.dropsOf(name, d, scope), [model, name, d, scope]);

  if (!rows.length) {
    return (
      <div class="page">
        <Empty>
          No enemy is called {name}. <Link to={routes.enemies()}>See every enemy</Link>
        </Empty>
      </div>
    );
  }
  const kind = model.speciesKind(name);
  // A name that is only a boss's part (Lucemon's orb) belongs under that boss.
  const partOf = model.isPartOnly(name) ? (rows[0].partOf ?? null) : null;
  const tabs: { id: EnemyTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'spawns', label: `Where it spawns${spawns.length ? ` (${spawns.length})` : ''}` },
    { id: 'drops', label: `Drops${drops.length ? ` (${drops.length})` : ''}` },
  ];

  return (
    <div class="page enemy-page">
      <header class="page-head">
        <nav class="crumbs" aria-label="Breadcrumb">
          {partOf ? (
            <Link to={routes.enemy(partOf)}>{partOf}</Link>
          ) : (
            <Link to={routes.enemies(kind === 'boss' ? 'boss' : 'all')}>
              {kind === 'boss' ? 'Bosses' : 'Enemies'}
            </Link>
          )}
        </nav>
        <div class="title-row">
          <h1>
            <KindDot kind={kind} />
            {name}
            <small>
              {partOf ? `Part of ${partOf}` : KIND_LABEL[kind]}
              {rows.length > 1 ? ` · ${rows.length} stat variants` : ''}
            </small>
          </h1>
          <SettingsBar unused />
        </div>
        <nav class="tabs" aria-label="Enemy sections">
          {tabs.map((t) => (
            <Link to={routes.enemy(name, t.id)} class={`tab${t.id === tab ? ' active' : ''}`}>
              <span aria-current={t.id === tab ? 'page' : undefined}>{t.label}</span>
            </Link>
          ))}
        </nav>
      </header>
      {tab === 'overview' && (
        <Overview name={name} variants={variants} spawns={spawns} drops={drops} />
      )}
      {tab === 'spawns' && <Spawns name={name} spawns={spawns} />}
      {tab === 'drops' && <Drops drops={drops} />}
    </div>
  );
}

type Spawns = ReturnType<Model['spawnsOf']>;
type Drops = ReturnType<Model['dropsOf']>;

/** Stats and resistances, one row per variant that spawns on the chosen difficulty. */
function VariantTables({ variants }: { variants: Enemy[] }) {
  const stat = (label: string, pick: (e: Enemy) => number) => ({ label, pick });
  const stats = [
    stat('HP', (e) => e.hp),
    stat('Strength', (e) => e.stats.strength),
    stat('Defense', (e) => e.stats.defense),
    stat('Wisdom', (e) => e.stats.wisdom),
    stat('Spirit', (e) => e.stats.spirit),
    stat('Speed', (e) => e.stats.speed),
    stat('EXP', (e) => e.stats.exp),
  ];
  const resists = [
    stat('Fire', (e) => e.resist.fire),
    stat('Ice', (e) => e.resist.ice),
    stat('Thunder', (e) => e.resist.thunder),
    stat('Dark', (e) => e.resist.dark),
    stat('Stun', (e) => e.resist.stun),
    stat('Poison', (e) => e.resist.poison),
  ];
  const table = (caption: string, cols: typeof stats) => (
    <div class="table-scroll">
      <table class="browse">
        <caption class="sub">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Variant</th>
            {cols.map((c) => (
              <th scope="col" class="n">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {variants.map((e) => (
            <tr>
              <th scope="row">{variantLabel(e)}</th>
              {cols.map((c) => (
                <td class="n">{fmt(c.pick(e))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <>
      {table('Stats', stats)}
      {table('Resistances', resists)}
    </>
  );
}

/** A boss's parts and minions: what else is in the fight, with its stats. */
function Parts({ parts }: { parts: ReturnType<Model['partsOf']> }) {
  return (
    <div class="table-scroll">
      <table class="browse">
        <caption class="sub">Parts and helpers</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col" class="n" title="How many the fight's spawners place">
              In the fight
            </th>
            <th scope="col" class="n">
              HP
            </th>
            <th scope="col" class="n">
              EXP
            </th>
          </tr>
        </thead>
        <tbody>
          {parts.map((p) => (
            <tr>
              <th scope="row">
                <Link to={routes.enemy(p.name)}>{p.name}</Link>
                {p.rows.some((r) => r.form) && (
                  <span class="muted"> · {[...new Set(p.rows.map(variantLabel))].join(', ')}</span>
                )}
              </th>
              <td class="n">{p.count || '–'}</td>
              <td class="n">{range(p.rows.map((r) => r.hp))}</td>
              <td class="n">{range(p.rows.map((r) => r.stats.exp))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Overview(props: { name: string; variants: Enemy[]; spawns: Spawns; drops: Drops }) {
  const { name, variants, spawns, drops } = props;
  const { model, settings, scope } = useApp();
  const where = settingsText(settings.difficulty, settings.players);
  const most = spawns[0];
  const best = drops[0];
  const parts = model.partsOf(name, settings.difficulty, scope);
  const partOf = model.isPartOnly(name) ? model.speciesRows(name)[0].partOf : undefined;
  return (
    <div class="enemy-overview">
      {partOf && (
        <p class="note">
          Part of the fight with <Link to={routes.enemy(partOf)}>{partOf}</Link>; that page shows
          the whole fight.
        </p>
      )}
      {!spawns.length && (
        <p class="note">
          It does not spawn anywhere on {where}; all of its stat variants are shown.
        </p>
      )}
      {spawns.length > 0 && variants.length > 1 && (
        <p class="note">
          {variants.every((v) => v.form)
            ? `Its ${variants.length} forms on ${where}, in the order you fight them.`
            : `The ${variants.length} variants that spawn on ${where} (area tiers, crown ranks or forms). Each room uses some of them; the map shows which.`}
        </p>
      )}
      <VariantTables variants={variants} />
      {parts.length > 0 && <Parts parts={parts} />}
      <div class="summary-cards">
        <Link to={routes.enemy(name, 'spawns')} class="summary-card">
          <h2>Where it spawns</h2>
          {most ? (
            <p>
              Most in <strong>{model.stageTitle(most.stage)}</strong> ({most.total}), and{' '}
              {plural(spawns.length - 1, 'more room')}.
            </p>
          ) : (
            <p class="muted">Nowhere on {where}.</p>
          )}
        </Link>
        <Link to={routes.enemy(name, 'drops')} class="summary-card">
          <h2>Drops</h2>
          {best ? (
            <p>
              Best: <strong>{model.itemLabel(best.key)}</strong> at {formatPercent(best.percent)}{' '}
              per kill, and {plural(drops.length - 1, 'more item')}.
            </p>
          ) : (
            <p class="muted">Nothing on {where}.</p>
          )}
        </Link>
      </div>
    </div>
  );
}

function Spawns({ name, spawns }: { name: string; spawns: Spawns }) {
  const { model, settings } = useApp();
  if (!spawns.length)
    return (
      <Empty>
        It does not spawn anywhere on {settingsText(settings.difficulty, settings.players)}.
      </Empty>
    );
  return (
    <section>
      <p class="note">
        Rooms on {settingsText(settings.difficulty, settings.players)}, most placed first. Open one
        to see its spawners highlighted.
      </p>
      <ol class="drop-maps">
        {spawns.map((s) => {
          const labels = s.rows
            .map((r) => model.enemies.get(r))
            .filter((e): e is Enemy => !!e)
            .sort((a, b) => a.hp - b.hp)
            .map(variantLabel);
          return (
            <li>
              <Link to={routes.map(s.stage.id, { kind: 'species', name }, true)} class="drop-map">
                <span class="pct count">{s.total}</span>
                <span class="grow">
                  <strong>{model.stageTitle(s.stage)}</strong>
                  {s.stage.area && <span class="muted"> · {s.stage.area}</span>}
                  <span class="detail muted">
                    {plural(s.spawners, 'spawner')} · {[...new Set(labels)].join(', ')}
                  </span>
                </span>
                <span class="go" aria-hidden="true">
                  Show on map →
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Drops below this chance are folded away until asked for. */
const RARE_PERCENT = 1;

function Drops({ drops }: { drops: Drops }) {
  const { model, settings } = useApp();
  const [all, setAll] = useState(false);
  if (!drops.length)
    return (
      <Empty>It drops nothing on {settingsText(settings.difficulty, settings.players)}.</Empty>
    );
  const common = drops.filter((x, i) => x.percent >= RARE_PERCENT || i < 8);
  const shown = all ? drops : common;
  const rare = drops.length - common.length;
  return (
    <section>
      <p class="note">
        Best chance per kill on {settingsText(settings.difficulty, settings.players)}. The chance
        can differ between rooms; the best rooms are listed.
      </p>
      <div class="table-scroll">
        <table class="browse">
          <thead>
            <tr>
              <th scope="col" class="n">
                Chance
              </th>
              <th scope="col">Item</th>
              <th scope="col">Type</th>
              <th scope="col">Best rooms</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((x) => (
              <tr>
                <td class="n pct">{formatPercent(x.percent)}</td>
                <td>
                  <ItemLink itemKey={x.key} />
                </td>
                <td class="muted">{categoryLabel(x.category)}</td>
                <td class="rooms">
                  {x.stages.slice(0, 3).map((s, i) => (
                    <>
                      {i > 0 && ', '}
                      <Link to={routes.map(s.stage.id, { kind: 'item', key: x.key }, true)}>
                        {model.stageTitle(s.stage)}
                      </Link>
                    </>
                  ))}
                  {x.stages.length > 3 && <span class="muted"> +{x.stages.length - 3}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rare > 0 && (
        <button type="button" class="link more" onClick={() => setAll(!all)} aria-expanded={all}>
          {all
            ? 'Show fewer'
            : `Show ${rare} rarer drop${rare === 1 ? '' : 's'} (under ${RARE_PERCENT}% each)`}
        </button>
      )}
    </section>
  );
}
