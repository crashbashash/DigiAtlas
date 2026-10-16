// Where exported data comes from: a dev server in the browser, or the chosen folder in the desktop app.

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
  private readonly urls = new Map<string, Promise<string>>();
  constructor(
    private readonly invoke: Invoke,
    readonly label: string,
  ) {}
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
      url = this.bytes(file).then((b) => URL.createObjectURL(new Blob([b as BlobPart], { type: 'image/png' })));
      this.urls.set(file, url);
    }
    return url;
  }
}

export const inDesktopApp = (): boolean => '__TAURI_INTERNALS__' in window;

async function tauriInvoke(): Promise<Invoke> {
  return (await import('@tauri-apps/api/core')).invoke as Invoke;
}

/** The folder the desktop app has remembered, if any. */
export async function openRemembered(): Promise<DataSource | null> {
  if (!inDesktopApp()) return new HttpSource();
  const invoke = await tauriInvoke();
  const dir = await invoke<string | null>('get_data_dir');
  return dir ? new TauriSource(invoke, dir) : null;
}

/** Ask the user for a folder (desktop app only). */
export async function chooseFolder(): Promise<DataSource | null> {
  const invoke = await tauriInvoke();
  const dir = await invoke<string | null>('choose_data_dir');
  return dir ? new TauriSource(invoke, dir) : null;
}
