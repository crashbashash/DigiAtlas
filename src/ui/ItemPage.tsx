import { useMemo } from 'preact/hooks';
import { routes, type ItemTab } from '../app/route';
import { categoryLabel, formatPercent, statLabel } from '../data/logic';
import type { Model } from '../data/model';
import { DIFFICULTIES, DIFFICULTY_LABEL, type Difficulty } from '../data/types';
import { Empty, Link, SettingsBar, settingsText } from './common';
import { useApp } from './context';
import { ItemLink, StatGrid } from './pieces';

const exactPercent = (p: number): string => `${+p.toFixed(2)}%`;

/** The stage name without the "(Hard)" a shop's difficulty copies carry; the difficulties are listed beside it. */
const roomTitle = (model: Model, stage: Parameters<Model['stageTitle']>[0]) =>
  model.stageTitle(stage).replace(/ \((Normal|Hard|Very Hard)\)$/, '');

/** An item: what it is, where to get it, and what it can be traded or appraised for. */
export function ItemPage({ itemKey, tab }: { itemKey: string; tab: ItemTab }) {
  const { model, settings, scope } = useApp();
  const item = model.items.get(itemKey);
  const d = settings.difficulty;
  const maps = useMemo(() => model.mapsFor(itemKey, d, scope), [model, itemKey, d, scope]);
  const trades = useMemo(() => model.tradesFor(itemKey), [model, itemKey]);
  const appraisal = useMemo(() => model.appraisalTable(itemKey), [model, itemKey]);
  const appraisedFrom = useMemo(() => model.appraisedFrom(itemKey), [model, itemKey]);

  if (!item) {
    return (
      <div class="page">
        <Empty>
          That item is not in this data. <Link to={routes.home()}>Back to the start</Link>
        </Empty>
      </div>
    );
  }

  const tradeCount =
    trades.getFrom.length + trades.giveTo.length + (appraisal || appraisedFrom ? 1 : 0);
  const tabs: { id: ItemTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'drops', label: `Where it drops${maps.length ? ` (${maps.length})` : ''}` },
    { id: 'trades', label: `Trades & appraisal${tradeCount ? ` (${tradeCount})` : ''}` },
  ];

  return (
    <div class="page item-page">
      <header class="page-head">
        <nav class="crumbs" aria-label="Breadcrumb">
          <Link to={routes.search('', item.category)}>{categoryLabel(item.category)}</Link>
        </nav>
        <div class="title-row">
          <h1>
            {model.itemLabel(itemKey)}
            <small>
              {categoryLabel(item.category)}
              {item.skillType ? ` · ${item.skillType}` : ''}
            </small>
          </h1>
          {tab !== 'trades' && <SettingsBar unused />}
        </div>
        <nav class="tabs" aria-label="Item sections">
          {tabs.map((t) => (
            <Link to={routes.item(itemKey, t.id)} class={`tab${t.id === tab ? ' active' : ''}`}>
              <span aria-current={t.id === tab ? 'page' : undefined}>{t.label}</span>
            </Link>
          ))}
        </nav>
      </header>

      {tab === 'overview' && (
        <Overview
          itemKey={itemKey}
          maps={maps}
          trades={trades}
          appraisal={appraisal}
          appraisedFrom={appraisedFrom}
        />
      )}
      {tab === 'drops' && <Drops itemKey={itemKey} maps={maps} />}
      {tab === 'trades' && (
        <Trades
          itemKey={itemKey}
          trades={trades}
          appraisal={appraisal}
          appraisedFrom={appraisedFrom}
        />
      )}
    </div>
  );
}

type Maps = ReturnType<Model['mapsFor']>;
type TradeLists = ReturnType<Model['tradesFor']>;

function Overview(props: {
  itemKey: string;
  maps: Maps;
  trades: TradeLists;
  appraisal: ReturnType<Model['appraisalTable']>;
  appraisedFrom: ReturnType<Model['appraisedFrom']>;
}) {
  const { itemKey, maps, trades, appraisal, appraisedFrom } = props;
  const { model, settings } = useApp();
  const item = model.items.get(itemKey)!;
  const best = maps[0];
  const stats = Object.entries(item.stats ?? {}).map(
    ([k, v]) => [statLabel(k), v] as [string, number],
  );
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const tradeLines = [
    trades.getFrom.length || trades.giveTo.length
      ? `${plural(trades.getFrom.length, 'trader')} give it, ${trades.giveTo.length} take it.`
      : null,
    appraisal
      ? `The Appraiser turns it into one of ${plural(appraisal.rows.length, 'item')}.`
      : null,
    appraisedFrom ? `Can come from appraising ${appraisedFrom.from}.` : null,
  ].filter((x): x is string => !!x);
  return (
    <div class="item-overview">
      <section class="card">
        {item.description ? (
          <p class="desc">{item.description}</p>
        ) : (
          <p class="muted">No description.</p>
        )}
        {stats.length > 0 && <StatGrid stats={stats} />}
      </section>
      <div class="summary-cards">
        <Link to={routes.item(itemKey, 'drops')} class="summary-card">
          <h2>Where it drops</h2>
          {best ? (
            <p>
              Best chance <strong>{formatPercent(best.percent)}</strong> per kill in{' '}
              <strong>{model.stageTitle(best.stage)}</strong>
              {maps.length > 1 && <> and {maps.length - 1} more</>}
            </p>
          ) : (
            <p class="muted">
              No enemy or object drops it on {settingsText(settings.difficulty, settings.players)}.
            </p>
          )}
        </Link>
        <Link to={routes.item(itemKey, 'trades')} class="summary-card">
          <h2>Trades & appraisal</h2>
          {tradeLines.length ? (
            tradeLines.map((t) => <p>{t}</p>)
          ) : (
            <p class="muted">No trader deals in it, and the Appraiser does not make it.</p>
          )}
        </Link>
      </div>
    </div>
  );
}

function Drops({ itemKey, maps }: { itemKey: string; maps: Maps }) {
  const { model, settings, scope, setSettings } = useApp();
  const d = settings.difficulty;
  const elsewhere = useMemo(
    () =>
      maps.length
        ? []
        : DIFFICULTIES.filter((x) => x !== d)
            .map((x) => ({ d: x, count: model.mapsFor(itemKey, x, scope).length }))
            .filter((x) => x.count > 0),
    [model, itemKey, d, scope, maps.length],
  );
  if (!maps.length) {
    return (
      <div class="card">
        <p>No enemy or object drops this on {settingsText(d, settings.players)}.</p>
        {elsewhere.map((x) => (
          <p>
            <button
              type="button"
              class="link"
              onClick={() => setSettings({ difficulty: x.d as Difficulty })}
            >
              See {DIFFICULTY_LABEL[x.d]}
            </button>
            : drops in {x.count} map{x.count === 1 ? '' : 's'}
          </p>
        ))}
      </div>
    );
  }
  return (
    <section>
      <p class="note">
        Chance per kill on {settingsText(d, settings.players)}, best first. Open a map to see the
        enemies that drop it highlighted.
      </p>
      <ol class="drop-maps">
        {maps.map((m) => (
          <li>
            <Link
              to={routes.map(m.stage.id, { kind: 'item', key: itemKey }, true)}
              class="drop-map"
            >
              <span class="pct">{formatPercent(m.percent)}</span>
              <span class="grow">
                <strong>{model.stageTitle(m.stage)}</strong>
                {m.stage.area && <span class="muted"> · {m.stage.area}</span>}
                <span class="detail muted">
                  {m.droppedBy.join(', ')} · {m.spawners} spawner{m.spawners === 1 ? '' : 's'}
                </span>
              </span>
              <span class="go" aria-hidden="true">
                Show on map →
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Trades(props: {
  itemKey: string;
  trades: TradeLists;
  appraisal: ReturnType<Model['appraisalTable']>;
  appraisedFrom: ReturnType<Model['appraisedFrom']>;
}) {
  const { model } = useApp();
  const { trades, appraisal, appraisedFrom, itemKey } = props;
  const list = (links: TradeLists['getFrom'], verb: string) => (
    <ul class="trade-list">
      {links.map((t) => (
        <li>
          <Link to={routes.map(t.stage.id, { kind: 'item', key: itemKey })} class="trade-row">
            <span class="grow">
              <strong>{t.label}</strong> {verb} {t.other}
            </span>
            <span class="muted">
              {roomTitle(model, t.stage)}
              {t.difficulties.length < DIFFICULTIES.length &&
                ` · ${t.difficulties.map((x) => DIFFICULTY_LABEL[x]).join(', ')}`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
  const nothing = !trades.getFrom.length && !trades.giveTo.length && !appraisal && !appraisedFrom;
  return (
    <div class="trades">
      {nothing && <Empty>No trader deals in this item, and the appraiser does not make it.</Empty>}
      {trades.getFrom.length > 0 && (
        <section>
          <h2 class="sub">Trade for it ({trades.getFrom.length})</h2>
          {list(trades.getFrom, 'wants')}
        </section>
      )}
      {trades.giveTo.length > 0 && (
        <section>
          <h2 class="sub">Trade it in ({trades.giveTo.length})</h2>
          {list(trades.giveTo, 'gives')}
        </section>
      )}
      {appraisal && (
        <section>
          <h2 class="sub">Appraised into ({appraisal.cost} BIT)</h2>
          <p class="note">
            Take it to the Appraiser in the central area. What you get depends on your level; each
            column adds up to 100%.
          </p>
          <div class="table-scroll">
            <table class="appraisal">
              <thead>
                <tr>
                  <th />
                  {appraisal.columns.map((c) => (
                    <th>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {appraisal.rows.map((r) => (
                  <tr>
                    <td>
                      <ItemLink itemKey={r.key} />
                    </td>
                    {r.percents.map((p) => (
                      <td class={p ? 'pct' : 'pct muted'}>{p ? exactPercent(p) : '–'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {appraisedFrom && (
        <section>
          <h2 class="sub">
            Appraise {appraisedFrom.from} ({appraisedFrom.cost} BIT)
          </h2>
          <p class="note">
            Take it to the Appraiser in the central area; your level decides what it can become.
          </p>
          <ul class="trade-list">
            {appraisedFrom.ranges.map((r) => (
              <li class="trade-row static">
                <span class="grow">{r.label}</span>
                <span class="pct">{exactPercent(r.percent)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
