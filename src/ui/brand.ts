import type { Manifest } from '../data/types';
import { h } from './dom';

export function sidebarBrand(manifest: Manifest, onChangeData: (() => void) | null): HTMLElement {
  return h('header', { class: 'brand' },
    h('h1', null, 'DigiAtlas'),
    h('p', { class: 'muted' }, `Digimon World 4 · ${manifest.region.toUpperCase()} ${manifest.platform.toUpperCase()}`),
    onChangeData ? h('button', { class: 'link', onclick: onChangeData }, 'Change data folder') : null,
  );
}
