import { inDesktopApp } from '../data/source';
import type { Difficulty } from '../data/types';

/** The settings the numbers depend on; the main window owns them and the popouts follow. */
export interface Context {
  difficulty: Difficulty;
  players: number;
  showUnused: boolean;
}

export type Message =
  | { kind: 'goto'; stageId: string; itemKey: string; ctx: Context } // popout -> main window
  | { kind: 'context'; ctx: Context }; // main window -> popouts

const EVENT = 'digiatlas:message';
const CHANNEL = 'digiatlas';

/** The address of an item's details window, with the settings in force when it opened. */
export function popoutHash(itemKey: string, ctx: Context): string {
  const q = new URLSearchParams({ item: itemKey, d: ctx.difficulty, p: String(ctx.players) });
  if (ctx.showUnused) q.set('u', '1');
  return `#/popout?${q.toString()}`;
}

/** Open (or focus) the details window for an item. */
export async function openItemWindow(itemKey: string, title: string, ctx: Context): Promise<void> {
  const hash = popoutHash(itemKey, ctx);
  if (inDesktopApp()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const label = `popout-item-${itemKey.replace(/[^A-Za-z0-9]+/g, '-')}`;
    await invoke('open_popout', { label, hash, title });
  } else {
    window.open(`${location.pathname}${hash}`, `digiatlas-${itemKey}`, 'popup=yes,width=440,height=560');
  }
}

/** Send a message to the other windows (a popout talks to the main window and the other way round). */
export async function send(msg: Message): Promise<void> {
  if (inDesktopApp()) {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(EVENT, msg);
  } else {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage(msg);
    ch.close();
  }
}

/** Listen for messages from the other windows. */
export async function listenMessages(handler: (m: Message) => void): Promise<void> {
  if (inDesktopApp()) {
    const { listen } = await import('@tauri-apps/api/event');
    await listen<Message>(EVENT, (e) => handler(e.payload));
  } else {
    new BroadcastChannel(CHANNEL).onmessage = (e: MessageEvent<Message>) => handler(e.data);
  }
}

/** Bring this window to the front. */
export async function focusThisWindow(): Promise<void> {
  if (inDesktopApp()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setFocus();
  } else {
    window.focus();
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
