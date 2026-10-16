import type { DataSource } from '../data/source';
import { loadModel } from '../data/model';
import { DIFFICULTIES, DIFFICULTY_LABEL, type Difficulty } from '../data/types';
import { clear, h } from './dom';
import { sendGoto } from './ipc';
import { Panel } from './panel';
import { viewFromHash } from './router';
import type { State } from './state';

export const isPopout = (hash: string): boolean => /^#\/popout(\?|$)/.test(hash);

/** The item details window: the item card and where it drops, with its own difficulty and player count. */
export async function startPopout(root: HTMLElement, source: DataSource): Promise<void> {
  const model = await loadModel(source);
  const view = viewFromHash(location.hash.replace('#/popout', '#/'));
  let state: State = {
    stageId: null,
    difficulty: view.difficulty ?? 'normal',
    players: view.players ?? 1,
    showUnused: view.showUnused,
    selection: view.item && model.items.has(view.item) ? { kind: 'item', key: view.item } : { kind: 'none' },
    query: '',
  };

  const panel = new Panel(model, source, {
    selectGenerator: () => {},
    selectGroup: () => {},
    selectSpecies: () => {},
    clearSelection: () => {},
    showUnused: () => {},
    selectItem: (key) => set({ selection: { kind: 'item', key } }),
    setDifficulty: (difficulty) => set({ difficulty }),
    openItem: () => {},
    goToStage: (stageId) =>
      void sendGoto({
        stageId,
        itemKey: state.selection.kind === 'item' ? state.selection.key : null,
        difficulty: state.difficulty,
        players: state.players,
      }),
  });

  const controls = h('div', { class: 'popout-bar' });

  function set(patch: Partial<State>): void {
    state = { ...state, ...patch };
    render();
  }

  function render(): void {
    model.players = state.players;
    model.hideUnused = !state.showUnused;
    const diff = h('select', { 'aria-label': 'Difficulty', onchange: () => set({ difficulty: diff.value as Difficulty }) },
      ...DIFFICULTIES.map((d) => h('option', { value: d, selected: d === state.difficulty }, DIFFICULTY_LABEL[d])));
    diff.value = state.difficulty;
    const players = h('select', { 'aria-label': 'Players', onchange: () => set({ players: Number(players.value) }) },
      ...[1, 2, 3, 4].map((n) => h('option', { value: String(n), selected: n === state.players }, `${n} player${n === 1 ? '' : 's'}`)));
    players.value = String(state.players);
    clear(controls);
    controls.append(h('label', null, h('span', { class: 'muted' }, 'Difficulty'), diff), h('label', null, h('span', { class: 'muted' }, 'Players'), players));
    panel.render(state, null);
    if (state.selection.kind === 'item') document.title = model.itemLabel(state.selection.key);
  }

  root.className = 'popout';
  clear(root);
  root.append(controls, panel.el);
  render();
}
