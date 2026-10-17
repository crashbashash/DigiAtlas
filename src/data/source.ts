// Where the data comes from: a dev server in the browser, or the disc the desktop app imported.

export interface DataSource {
  readonly label: string;
  json<T>(file: string): Promise<T>;
  /** Object URL (or plain URL) for an exported image. */
  imageUrl(file: string): Promise<string>;
}

class HttpSource implements DataSource {
  readonly label = 'dev server';
  private readonly urls = new Map<string, Promise<string>>();
  async json<T>(file: string): Promise<T> {
    const res = await fetch(`/data/${file}`);
    if (!res.ok) throw new Error(`${file}: ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  }
  imageUrl(file: string): Promise<string> {
    return Promise.resolve(`/data/${file}`);
  }
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

class TauriSource implements DataSource {
  readonly label = 'imported disc';
  private readonly urls = new Map<string, Promise<string>>();
  constructor(private readonly invoke: Invoke) {}
  private async bytes(file: string): Promise<Uint8Array> {
    const buf = await this.invoke<ArrayBuffer>('read_data_file', { rel: file });
    return new Uint8Array(buf);
  }
  async json<T>(file: string): Promise<T> {
    return JSON.parse(new TextDecoder().decode(await this.bytes(file))) as T;
  }
  imageUrl(file: string): Promise<string> {
    let url = this.urls.get(file);
    if (!url) {
      url = this.bytes(file).then((b) =>
        URL.createObjectURL(new Blob([b as BlobPart], { type: 'image/png' })),
      );
      this.urls.set(file, url);
    }
    return url;
  }
}

export const inDesktopApp = (): boolean => '__TAURI_INTERNALS__' in window;

async function tauriInvoke(): Promise<Invoke> {
  return (await import('@tauri-apps/api/core')).invoke as Invoke;
}

/**
 * What the desktop app has imported: nothing yet, data ready to show, or data an older importer
 * wrote (or an unfinished one), which must be imported again before it is shown.
 */
export type DataState = { state: 'none' } | { state: 'ready' } | { state: 'stale'; reason: string };

/** The browser dev mode always reads the dev server's folder. */
export async function dataState(): Promise<DataState> {
  if (!inDesktopApp()) return { state: 'ready' };
  return (await tauriInvoke())<DataState>('data_state');
}

/** The data to show, once `dataState()` is ready. */
export async function openData(): Promise<DataSource> {
  return inDesktopApp() ? new TauriSource(await tauriInvoke()) : new HttpSource();
}

export interface ImportProgress {
  done: number;
  total: number;
  message: string;
}

/** Choosing a disc image and importing it; the desktop app's, or a stand-in for previews. */
export interface DiscImporter {
  /** Ask for a disc image; null when the user cancels. */
  choose(): Promise<string | null>;
  /** Import it, reporting each step; rejects with a readable message when it fails. */
  run(path: string, onProgress: (p: ImportProgress) => void): Promise<void>;
}

type ImportEvent =
  | ({ event: 'progress' } & ImportProgress)
  | { event: 'finished' }
  | { event: 'failed'; message: string };

export const desktopImporter: DiscImporter = {
  async choose() {
    return (await tauriInvoke())<string | null>('choose_disc_image');
  },
  async run(path, onProgress) {
    const { invoke, Channel } = await import('@tauri-apps/api/core');
    return new Promise<void>((resolve, reject) => {
      const events = new Channel<ImportEvent>((e) => {
        if (e.event === 'progress') onProgress(e);
        else if (e.event === 'finished') resolve();
        else reject(new Error(e.message));
      });
      invoke('import_disc', { path, events }).catch((e: unknown) =>
        reject(e instanceof Error ? e : new Error(String(e))),
      );
    });
  },
};

/** A view requested on the command line (`--open "#/stag0101?d=hard"`), desktop app only. */
export async function requestedView(): Promise<string | null> {
  if (!inDesktopApp()) return null;
  return (await tauriInvoke())<string | null>('start_view');
}

/** A disc image to import on start (`--iso PATH`), desktop app only. */
export async function requestedIso(): Promise<string | null> {
  if (!inDesktopApp()) return null;
  return (await tauriInvoke())<string | null>('start_iso');
}
