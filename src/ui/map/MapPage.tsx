import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { lastMap, rememberMap } from '../../app/navigation';
import { routes, type MapSelection } from '../../app/route';
import { itemKey } from '../../data/logic';
import type { Difficulty, Stage } from '../../data/types';
import { Empty, SettingsBar } from '../common';
import { useApp } from '../context';
import { MapView } from '../mapview';
import { StagePanel, type Resolved } from './StagePanel';
import { WorldTree } from './WorldTree';

const DEFAULT_STAGE = 'stag0102';

/** The difficulty a stage is shown on: the chosen one when the stage has it, else what it does have. */
function effectiveDifficulty(
  model: ReturnType<typeof useApp>['model'],
  stage: Stage,
  wanted: Difficulty,
): Difficulty {
  const avail = model.available(stage);
  const own = model.entryDifficulty(stage);
  if (own && avail.includes(own)) return own;
  return avail.includes(wanted) ? wanted : (avail[0] ?? wanted);
}

export function MapPage(props: { stageId: string | null; selection: MapSelection; zoom: boolean }) {
  const { model, settings, setSettings, go } = useApp();
  const fallback = [props.stageId, lastMap(), DEFAULT_STAGE, model.stages[0]?.id].find(
    (id): id is string => !!id && model.byId.has(id),
  );
  const stage = fallback ? model.stageOn(model.byId.get(fallback)!, settings.difficulty) : null;

  // Keep single-difficulty rooms consistent too: a missing copy uses its entry difficulty.
  // An address without a (known) stage gets the one shown, so links and Back point at it. Old-style
  // links (#/stag0102?...) are rewritten to the map page's own address too.
  const legacy = !location.hash.startsWith('#/map/');
  useEffect(() => {
    const own = stage && model.entryDifficulty(stage);
    if (own && own !== settings.difficulty) {
      setSettings({ difficulty: own });
      return;
    }
    if (stage && (props.stageId !== stage.id || legacy))
      go(routes.map(stage.id, props.selection, props.zoom), true);
  }, [stage?.id, props.stageId, legacy, settings.difficulty]);
  useEffect(() => {
    if (stage) rememberMap(stage.id);
  }, [stage?.id]);

  if (!stage) return <Empty>No stages in this data.</Empty>;
  return <StageMap stage={stage} selection={props.selection} zoom={props.zoom} />;
}

function StageMap({
  stage,
  selection,
  zoom,
}: {
  stage: Stage;
  selection: MapSelection;
  zoom: boolean;
}) {
  const { model, source, settings, scope, go } = useApp();
  const d = effectiveDifficulty(model, stage, settings.difficulty);
  const gens = model.generators(stage, d, scope);
  const hidden = model.hidden(stage, d, scope);

  // Spawners are named in the address; find this difficulty's index for the map and the panel.
  const resolved: Resolved = useMemo(() => {
    if (selection.kind !== 'spawner') return selection;
    const index = gens.findIndex((g) => g.name === selection.name);
    return index >= 0 ? { kind: 'generator', index } : { kind: 'none' };
  }, [selection, gens]);

  const select = (sel: MapSelection) =>
    go(routes.map(stage.id, sel), sel.kind !== 'none' && selection.kind === sel.kind);

  // What to highlight: the selected group, species or item droppers; and traders who deal in the item.
  const matches = useMemo(() => {
    if (resolved.kind !== 'group' && resolved.kind !== 'species' && resolved.kind !== 'item')
      return null;
    const out = new Set<number>();
    gens.forEach((g, i) => {
      if (hidden.has(i)) return;
      if (resolved.kind === 'group' && g.row === resolved.row) out.add(i);
      else if (resolved.kind === 'species' && model.enemies.get(g.row)?.name === resolved.name)
        out.add(i);
      else if (
        resolved.kind === 'item' &&
        model.tableFor(g, d).rows.some((r) => r.key === resolved.key)
      )
        out.add(i);
    });
    return out;
  }, [resolved, gens, hidden, d, model]);
  const litPins = useMemo(() => {
    if (resolved.kind !== 'item') return null;
    const has = (o: { category: string; id: number }) => itemKey(o.category, o.id) === resolved.key;
    const out = new Set<number>();
    model.tradersAt(stage, d).forEach((t, i) => {
      if ((t.tables[d] ?? []).some((o) => has(o.give) || has(o.get))) out.add(i);
    });
    return out;
  }, [resolved, stage, d, model]);

  // One canvas for the life of the page; it keeps its own pan and zoom.
  const [reveal, setReveal] = useState<{
    kind: 'trader' | 'service';
    index: number;
    n: number;
  } | null>(null);
  // The canvas outlives renders, so its callbacks read the current values through a ref.
  const handlers = useRef({
    select,
    selection,
    gens,
    service: (index: number) => setReveal((r) => ({ kind: 'service', index, n: (r?.n ?? 0) + 1 })),
    reveal: (index: number) => setReveal((r) => ({ kind: 'trader', index, n: (r?.n ?? 0) + 1 })),
  });
  handlers.current = { ...handlers.current, select, selection, gens };
  const map = useMemo(
    () =>
      new MapView(model, source, {
        onSelect: (gi) => {
          const { select: pick, gens: list, selection: current } = handlers.current;
          if (gi !== null && list[gi]) pick({ kind: 'spawner', name: list[gi].name });
          else if (current.kind === 'spawner' || current.kind === 'group') pick({ kind: 'none' });
        },
        onTrader: (index) => handlers.current.reveal(index),
        onService: (index) => handlers.current.service(index),
      }),
    [model, source],
  );
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    host.current?.append(map.el);
  }, [map]);
  useEffect(() => {
    map.show(
      stage,
      d,
      scope,
      matches,
      resolved.kind === 'generator' ? resolved.index : null,
      litPins,
    );
  });

  // Arriving from an item page: frame the droppers once, then drop the request from the address.
  useEffect(() => {
    if (!zoom) return;
    if (matches?.size || litPins?.size) map.zoomTo(matches ?? new Set(), litPins);
    go(routes.map(stage.id, selection), true);
  }, [zoom, stage.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (selection.kind !== 'none') select({ kind: 'none' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const avail = model.mapDifficulties(stage);
  const spawns = model.hasSpawns(stage);
  const canZoom = !!(matches?.size || litPins?.size);
  // Item and enemy selections follow you from room to room; spawners belong to one stage.
  const keep: MapSelection =
    selection.kind === 'item' || selection.kind === 'species' ? selection : { kind: 'none' };

  return (
    <div class="map-page">
      <nav class="sidebar" aria-label="Rooms">
        <WorldTree currentId={stage.id} keep={keep} />
      </nav>
      <main class="map-main">
        <header class="topbar">
          <h1 class="title">
            {model.stageTitle(stage)}
            {stage.area && <span class="muted">{stage.area}</span>}
          </h1>
          <SettingsBar
            difficulties={avail}
            players={spawns}
            unused={spawns ? model.unusedCount(stage, d) : 0}
          />
        </header>
        <div class="map-host" ref={host}>
          <div class="map-tools">
            {canZoom && (
              <button
                type="button"
                onClick={() => map.zoomTo(matches ?? new Set(), litPins)}
                title="Zoom to the highlighted markers"
              >
                Zoom to matches
              </button>
            )}
            <button
              type="button"
              onClick={() => map.fit()}
              title="Fit the map to the window (or double-click the map)"
            >
              Fit
            </button>
          </div>
        </div>
      </main>
      <StagePanel
        stage={stage}
        difficulty={d}
        selection={resolved}
        itemSpawners={resolved.kind === 'item' ? (matches?.size ?? 0) : 0}
        reveal={reveal}
        select={select}
      />
    </div>
  );
}
