import { inDesktopApp } from '../data/source';
import type { Difficulty } from '../data/types';

/** What a popout asks the main window to do: show a stage with an item highlighted. */
export interface GotoMessage {
  stageId: string;
  itemKey: string | null;
  difficulty: Difficulty;
  players: number;
}

export interface PopoutContext {
  difficulty: Difficulty;
  players: number;
  showUnused: boolean;
}

const EVENT = 'digiatlas:goto';
const CHANNEL = 'digiatlas';

export function popoutHash(itemKey: string, ctx: PopoutContext): string {
  const q = new URLSearchParams({ item: itemKey, d: ctx.difficulty, p: String(ctx.players) });
  if (ctx.showUnused) q.set('u', '1');
  return `#/popout?${q.toString()}`;
}

/** Open (or focus) the details window for an item. */
export async function openItemWindow(itemKey: string, title: string, ctx: PopoutContext): Promise<void> {
  const hash = popoutHash(itemKey, ctx);
  if (inDesktopApp()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const label = `popout-item-${itemKey.replace(/[^A-Za-z0-9]+/g, '-')}`;
    await invoke('open_popout', { label, hash, title });
  } else {
    window.open(`${location.pathname}${hash}`, `digiatlas-${itemKey}`, 'popup=yes,width=520,height=780');
  }
}

/** From a popout: ask the main window to show a stage. */
export async function sendGoto(msg: GotoMessage): Promise<void> {
  if (inDesktopApp()) {
    const { emitTo } = await import('@tauri-apps/api/event');
    await emitTo('main', EVENT, msg);
  } else {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage(msg);
    ch.close();
  }
}

/** In the main window: react to a popout's request and bring the window forward. */
export async function onGoto(handler: (m: GotoMessage) => void): Promise<void> {
  if (inDesktopApp()) {
    const [{ listen }, { getCurrentWindow }] = await Promise.all([
      import('@tauri-apps/api/event'),
      import('@tauri-apps/api/window'),
    ]);
    await listen<GotoMessage>(EVENT, (e) => {
      handler(e.payload);
      void getCurrentWindow().setFocus();
    });
  } else {
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e: MessageEvent<GotoMessage>) => {
      handler(e.data);
      window.focus();
    };
  }
}
