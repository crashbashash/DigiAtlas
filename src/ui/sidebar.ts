import type { Model, Room } from '../data/model';
import { categoryLabel, itemMatchesQuery } from '../data/logic';
import { DIFFICULTY_LABEL, VARIANT_DIFFICULTY, type Stage } from '../data/types';
import { clear, h } from './dom';

export interface SidebarActions {
  query(q: string): void;
  goToStage(stageId: string): void;
  selectItem(key: string): void;
  selectSpecies(name: string): void;
}

const RESULT_LIMIT = 8;

export class Sidebar {
  readonly el = h('nav', { class: 'sidebar' });
  private readonly input = h('input', {
    type: 'search',
    placeholder: 'Search items, enemies, rooms',
    spellcheck: 'false',
    oninput: () => this.act.query(this.input.value),
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') this.results.querySelector<HTMLButtonElement>('.hit')?.click();
    },
  });
  private readonly results = h('div', { class: 'results' });
  private readonly tree = h('div', { class: 'tree' });
  private readonly open = new Set<string>();
  private lastWorld = '';

  constructor(
    private readonly model: Model,
    private readonly act: SidebarActions,
    brand: HTMLElement,
  ) {
    this.el.append(brand, h('div', { class: 'search' }, this.input), this.results, this.tree);
    this.open.add(model.worlds[0]?.area ?? '');
  }

  focusSearch(): void {
    this.input.focus();
    this.input.select();
  }

  clearSearch(): void {
    this.input.value = '';
  }

  render(query: string, currentId: string | null): void {
    if (this.input.value !== query) this.input.value = query;
    this.renderResults(query.trim().toLowerCase());
    this.renderTree(currentId);
  }

  private renderResults(q: string): void {
    clear(this.results);
    this.results.hidden = q.length < 2;
    if (q.length < 2) return;
    const items = [...this.model.items.entries()]
      .filter(([, i]) => itemMatchesQuery(i, q))
      .slice(0, RESULT_LIMIT);
    const species = new Map<string, number>();
    for (const e of this.model.enemies.values()) if (e.name.toLowerCase().includes(q) && e.kind !== 'object') species.set(e.name, e.row);
    const rooms = this.model.worlds
      .flatMap((w) => w.rooms)
      .filter((r) => r.room.toLowerCase().includes(q) || r.area.toLowerCase().includes(q))
      .slice(0, RESULT_LIMIT);

    const group = (title: string, rows: HTMLElement[]) =>
      rows.length ? h('div', { class: 'group' }, h('div', { class: 'sub' }, title), ...rows) : null;
    const nodes = [
      group('Items', items.map(([key, i]) =>
        h('button', { class: 'hit', onclick: () => this.act.selectItem(key) }, this.model.itemLabel(key), h('span', { class: 'muted' }, categoryLabel(i.category))))),
      group('Enemies', [...species.keys()].slice(0, RESULT_LIMIT).map((name) =>
        h('button', { class: 'hit', onclick: () => this.act.selectSpecies(name) }, name))),
      group('Rooms', rooms.map((r) =>
        h('button', { class: 'hit', onclick: () => this.act.goToStage(r.stages[0].id) }, r.room, h('span', { class: 'muted' }, r.area)))),
    ].filter(Boolean) as HTMLElement[];
    if (!nodes.length) this.results.append(h('p', { class: 'muted pad' }, 'No matches.'));
    else this.results.append(...nodes);
  }

  private renderTree(currentId: string | null): void {
    clear(this.tree);
    const current = this.model.worlds.find((w) => w.rooms.some((r) => r.stages.some((st) => st.id === currentId)))?.area ?? '';
    // Moving to another world folds the others away so the list stays short.
    if (current && current !== this.lastWorld) {
      this.open.clear();
      this.open.add(current);
      this.lastWorld = current;
    }
    for (const w of this.model.worlds) {
      const isOpen = this.open.has(w.area);
      this.tree.append(
        h('button', {
          class: 'world' + (isOpen ? ' open' : ''),
          'aria-expanded': String(isOpen),
          onclick: () => {
            if (this.open.has(w.area)) this.open.delete(w.area);
            else this.open.add(w.area);
            this.renderTree(currentId);
          },
        }, w.area, h('span', { class: 'muted' }, `${w.rooms.length}`)),
      );
      if (isOpen) this.tree.append(h('div', { class: 'rooms' }, ...w.rooms.map((r) => this.roomEl(r, currentId))));
    }
    this.tree.querySelector('.room.active')?.scrollIntoView({ block: 'nearest' });
  }

  private roomEl(r: Room, currentId: string | null): HTMLElement {
    const active = r.stages.some((s) => s.id === currentId);
    const first: Stage = r.stages[0];
    const chips = r.stages.length > 1
      ? h('div', { class: 'floors' }, ...r.stages.map((s) =>
          h('button', { class: 'chip' + (s.id === currentId ? ' on' : ''), onclick: () => this.act.goToStage(s.id) },
            [s.floor, s.variant ? DIFFICULTY_LABEL[VARIANT_DIFFICULTY[s.variant]] : null].filter(Boolean).join(' ') || s.id)))
      : null;
    return h('div', { class: 'room' + (active ? ' active' : '') },
      h('button', { class: 'name', onclick: () => this.act.goToStage(active ? currentId! : first.id) }, r.room),
      active ? chips : null,
    );
  }
}
