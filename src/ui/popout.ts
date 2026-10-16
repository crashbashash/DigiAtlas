import type { DataSource } from '../data/source';
import { loadModel } from '../data/model';
import { clear, h } from './dom';
import { closeThisWindow } from './ipc';
import { Panel } from './panel';
import { viewFromHash } from './router';

export const isPopout = (hash: string): boolean => /^#\/popout(\?|$)/.test(hash);

/** The item details window: just the item card and a Close button. */
export async function startPopout(root: HTMLElement, source: DataSource): Promise<void> {
  const model = await loadModel(source);
  const key = viewFromHash(location.hash.replace('#/popout', '#/')).item;
  const none = () => {};
  const panel = new Panel(model, source, {
    selectGenerator: none, selectGroup: none, selectSpecies: none, clearSelection: none, showUnused: none,
    selectItem: none, setDifficulty: none, openItem: none, goToStage: none,
  });
  panel.render(
    { stageId: null, difficulty: 'normal', players: 1, showUnused: false, selection: key ? { kind: 'item', key } : { kind: 'none' }, query: '' },
    null,
  );
  if (key) document.title = model.itemLabel(key);

  root.className = 'popout';
  clear(root);
  root.append(
    panel.el,
    h('footer', { class: 'popout-footer' }, h('button', { class: 'primary', onclick: () => void closeThisWindow() }, 'Close')),
  );
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') void closeThisWindow();
  });
}
