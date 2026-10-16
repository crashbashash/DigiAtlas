import type { DataSource } from '../data/source';
import { loadModel } from '../data/model';
import { clear, h } from './dom';
import { closeThisWindow, listenMessages, send, type Context } from './ipc';
import { Panel } from './panel';
import { viewFromHash } from './router';
import type { State } from './state';

export const isPopout = (hash: string): boolean => /^#\/popout(\?|$)/.test(hash);

/**
 * The item details window: the item card, the maps it drops in and a Close button. It follows the main
 * window's difficulty and player count, and clicking a map opens it there with the droppers highlighted.
 */
export async function startPopout(root: HTMLElement, source: DataSource): Promise<void> {
  const model = await loadModel(source);
  const view = viewFromHash(location.hash.replace('#/popout', '#/'));
  const key = view.item && model.items.has(view.item) ? view.item : null;
  let ctx: Context = { difficulty: view.difficulty ?? 'normal', players: view.players ?? 1, showUnused: view.showUnused };

  const none = () => {};
  const panel = new Panel(model, source, {
    selectGenerator: none, selectGroup: none, selectSpecies: none, clearSelection: none, showUnused: none,
    selectItem: none, setDifficulty: none, openItem: none,
    goToStage: (stageId) => {
      if (key) void send({ kind: 'goto', stageId, itemKey: key, ctx });
    },
  });

  function render(): void {
    model.players = ctx.players;
    model.hideUnused = !ctx.showUnused;
    const state: State = {
      stageId: null, difficulty: ctx.difficulty, players: ctx.players, showUnused: ctx.showUnused,
      selection: key ? { kind: 'item', key } : { kind: 'none' }, query: '',
    };
    panel.render(state, null);
  }

  if (key) document.title = model.itemLabel(key);
  root.className = 'popout';
  clear(root);
  root.append(
    panel.el,
    h('footer', { class: 'popout-footer' }, h('button', { class: 'primary', onclick: () => void closeThisWindow() }, 'Close')),
  );
  render();
  void listenMessages((m) => {
    if (m.kind === 'context') {
      ctx = m.ctx;
      render();
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') void closeThisWindow();
  });
}
