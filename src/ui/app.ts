import type { DataSource } from '../data/source';
import type { Model } from '../data/model';
import { DIFFICULTIES, DIFFICULTY_LABEL, type Difficulty, type Stage } from '../data/types';
import { clear, h } from './dom';
import { MapView } from './mapview';
import { openItemWindow } from './ipc';
import { Panel } from './panel';
import { sidebarBrand } from './brand';
import { Sidebar } from './sidebar';
import { hashFor, loadSaved, save, stateFromView, viewFromHash } from './router';
import { Store, type State } from './state';

const DEFAULT_STAGE = 'stag0102';

export class App {
  private readonly store: Store;
  private readonly sidebar: Sidebar;
  private readonly panel: Panel;
  private readonly map: MapView;
  private readonly title = h('div', { class: 'title' });
  private readonly diffs = h('div', { class: 'diffs' });
  private readonly zoom: HTMLButtonElement;
  private matches: Set<number> | null = null;
  private applying = false;

  constructor(
    root: HTMLElement,
    private readonly model: Model,
    source: DataSource,
    private readonly onChangeData: (() => void) | null,
  ) {
    const first = model.byId.has(DEFAULT_STAGE) ? DEFAULT_STAGE : (model.stages[0]?.id ?? null);
    const base: State = { stageId: first, difficulty: 'hard', players: 1, showUnused: false, selection: { kind: 'none' }, query: '' };
    // The address wins, then the last view, then the default.
    const view = location.hash.length > 2 ? viewFromHash(location.hash) : { ...viewFromHash(''), ...loadSaved() };
    const initial = stateFromView(model, view, base);
    model.players = initial.players;
    model.hideUnused = !initial.showUnused;
    this.store = new Store(initial);

    this.map = new MapView(model, source, {
      onSelect: (gi) => {
        const sel = this.store.state.selection;
        if (gi !== null) this.store.set({ selection: { kind: 'generator', index: gi } });
        else if (sel.kind === 'generator' || sel.kind === 'group') this.store.set({ selection: { kind: 'none' } });
      },
    });
    this.panel = new Panel(model, source, {
      selectGenerator: (index) => this.store.set({ selection: { kind: 'generator', index } }),
      selectGroup: (row) => this.store.set({ selection: { kind: 'group', row } }),
      selectItem: (key) => this.showItem(key),
      openItem: (key) => this.openItem(key),
      selectSpecies: (name) => this.store.set({ selection: { kind: 'species', name } }),
      goToStage: (id) => this.goToStage(id),
      setDifficulty: (d) => this.setDifficulty(d),
      showUnused: (show) => this.store.set({ showUnused: show }),
      clearSelection: () => this.store.set({ selection: { kind: 'none' } }),
    });
    this.sidebar = new Sidebar(
      model,
      {
        query: (q) => this.store.set({ query: q }),
        goToStage: (id) => {
          this.store.set({ query: '' });
          this.goToStage(id, true);
        },
        selectItem: (key) => this.showItem(key),
        selectSpecies: (name) => this.store.set({ selection: { kind: 'species', name } }),
      },
      sidebarBrand(model.raw.manifest, onChangeData),
    );

    this.zoom = h('button', { class: 'fit', hidden: true, title: 'Zoom the map to the highlighted spawners', onclick: () => this.matches && this.map.zoomTo(this.matches) }, 'Zoom to matches');
    const topbar = h('div', { class: 'topbar' }, this.title, this.zoom, this.diffs,
      h('button', { class: 'fit', title: 'Fit the map to the window (double-click the map)', onclick: () => this.map.fit() }, 'Fit'));
    clear(root);
    root.append(this.sidebar.el, h('main', null, topbar, this.map.el), this.panel.el);

    this.store.subscribe((s, prev) => this.update(s, prev));
    this.update(this.store.state, null);
    history.replaceState(null, '', hashFor(model, this.store.state));
    save(this.store.state);

    window.addEventListener('popstate', () => {
      this.applying = true;
      this.store.set(stateFromView(model, viewFromHash(location.hash), { ...this.store.state, query: '' }));
      this.applying = false;
      save(this.store.state);
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  private goToStage(id: string, resetSelection = false): void {
    const stage = this.model.byId.get(id);
    if (!stage) return;
    const avail = this.model.available(stage);
    const d = avail.includes(this.store.state.difficulty) ? this.store.state.difficulty : (avail[0] ?? 'normal');
    const sel = this.store.state.selection;
    const keep = !resetSelection && (sel.kind === 'item' || sel.kind === 'species');
    this.store.set({ stageId: id, difficulty: d, selection: keep ? sel : { kind: 'none' } });
  }

  /** Highlight an item on the map and open its details in a window of their own. */
  private showItem(key: string): void {
    this.store.set({ selection: { kind: 'item', key } });
    this.openItem(key);
  }

  private openItem(key: string): void {
    void openItemWindow(key, this.model.itemLabel(key));
  }

  private setDifficulty(d: Difficulty): void {
    const { selection: sel, stageId } = this.store.state;
    let next = sel;
    if (sel.kind === 'generator') {
      // Spawners are per difficulty; keep the same one (by name) when it exists on the new one.
      const stage = stageId ? this.model.byId.get(stageId) : undefined;
      const name = stage ? this.model.generators(stage, this.store.state.difficulty)[sel.index]?.name : undefined;
      const index = stage && name ? this.model.generators(stage, d).findIndex((g) => g.name === name) : -1;
      next = index >= 0 ? { kind: 'generator', index } : { kind: 'none' };
    } else if (sel.kind === 'group') {
      next = { kind: 'none' };
    }
    this.store.set({ difficulty: d, selection: next });
  }

  private stage(s: State): Stage | null {
    return s.stageId ? (this.model.byId.get(s.stageId) ?? null) : null;
  }

  private highlight(s: State, stage: Stage | null): Set<number> | null {
    if (!stage) return null;
    const gens = this.model.generators(stage, s.difficulty);
    const sel = s.selection;
    const out = new Set<number>();
    const hidden = this.model.hidden(stage, s.difficulty);
    gens.forEach((g, i) => {
      if (hidden.has(i)) return;
      if (sel.kind === 'group' && g.row === sel.row) out.add(i);
      else if (sel.kind === 'species' && this.model.enemies.get(g.row)?.name === sel.name) out.add(i);
      else if (sel.kind === 'item' && this.model.tableFor(g, s.difficulty).rows.some((r) => r.key === sel.key)) out.add(i);
    });
    return sel.kind === 'group' || sel.kind === 'species' || sel.kind === 'item' ? out : null;
  }

  private onKey(e: KeyboardEvent): void {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    if (e.key === '/' && !typing) {
      e.preventDefault();
      this.sidebar.focusSearch();
    } else if (e.key === 'Escape') {
      const s = this.store.state;
      if (s.query) {
        this.sidebar.clearSearch();
        this.store.set({ query: '' });
      } else if (s.selection.kind !== 'none') {
        this.store.set({ selection: { kind: 'none' } });
      }
    }
  }

  private syncAddress(s: State, prev: State | null): void {
    if (this.applying || !prev) return;
    save(s);
    const next = hashFor(this.model, s);
    if (next === location.hash) return;
    // A new stage or a new kind of selection is a step you may want to go back to; refining is not.
    const step = prev.stageId !== s.stageId || prev.selection.kind !== s.selection.kind;
    if (step) history.pushState(null, '', next);
    else history.replaceState(null, '', next);
  }

  private update(s: State, prev: State | null): void {
    this.model.players = s.players;
    this.model.hideUnused = !s.showUnused;
    this.syncAddress(s, prev);
    const stage = this.stage(s);
    if (!prev || prev.query !== s.query || prev.stageId !== s.stageId) this.sidebar.render(s.query, s.stageId);
    if (stage) {
      this.title.textContent = '';
      this.title.append(h('strong', null, this.model.stageTitle(stage)), h('span', { class: 'muted' }, stage.area ?? ''));
      this.renderDifficulties(s, stage);
      const sel = s.selection;
      this.matches = this.highlight(s, stage);
      this.zoom.hidden = !this.matches || this.matches.size === 0;
      this.map.show(stage, s.difficulty, this.matches, sel.kind === 'generator' ? sel.index : null);
    }
    this.panel.render(s, stage);
  }

  private renderDifficulties(s: State, stage: Stage): void {
    clear(this.diffs);
    const avail = this.model.available(stage);
    const select = h('select', { 'aria-label': 'Difficulty', onchange: () => this.setDifficulty(select.value as Difficulty) },
      ...(DIFFICULTIES as Difficulty[]).map((d) =>
        h('option', { value: d, selected: d === s.difficulty, disabled: !avail.includes(d) },
          DIFFICULTY_LABEL[d] + (avail.includes(d) ? '' : ' (no data)'))),
    );
    select.value = s.difficulty;
    const players = h('select', { 'aria-label': 'Players', title: 'Spawn counts and drops depend on how many players are in the game', onchange: () => this.store.set({ players: Number(players.value) }) },
      ...[1, 2, 3, 4].map((n) => h('option', { value: String(n), selected: n === s.players }, `${n} player${n === 1 ? '' : 's'}`)),
    );
    players.value = String(s.players);
    const unusedCount = this.model.unusedCount(stage, s.difficulty);
    const unused = h('input', { type: 'checkbox', onchange: () => this.store.set({ showUnused: unused.checked }) });
    unused.checked = s.showUnused;
    this.diffs.append(
      h('label', null, h('span', { class: 'muted' }, 'Players'), players),
      h('label', null, h('span', { class: 'muted' }, 'Difficulty'), select),
    );
    if (unusedCount) {
      this.diffs.append(
        h('label', { class: 'check', title: 'Spawners that no game script starts. They most likely never appear, so they are hidden unless you ask.' }, unused, `Show ${unusedCount} unused`),
      );
    }
  }
}
