import { inDesktopApp } from '../data/source';

/** The address of an item's details window. */
export const popoutHash = (itemKey: string): string => `#/popout?item=${encodeURIComponent(itemKey)}`;

/** Open (or focus) the details window for an item. */
export async function openItemWindow(itemKey: string, title: string): Promise<void> {
  const hash = popoutHash(itemKey);
  if (inDesktopApp()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const label = `popout-item-${itemKey.replace(/[^A-Za-z0-9]+/g, '-')}`;
    await invoke('open_popout', { label, hash, title });
  } else {
    window.open(`${location.pathname}${hash}`, `digiatlas-${itemKey}`, 'popup=yes,width=440,height=520');
  }
}

/** Close the window this runs in. */
export async function closeThisWindow(): Promise<void> {
  if (inDesktopApp()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  } else {
    window.close();
  }
}
