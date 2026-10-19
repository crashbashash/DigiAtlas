export interface UpdateOffer {
  version: string;
  currentVersion: string;
  releases: { version: string; notes: string }[];
  method: 'msi' | 'browser';
}
export interface UpdateCheck {
  currentVersion: string;
  update: UpdateOffer | null;
}
export interface UpdateBackend {
  check(): Promise<UpdateCheck>;
  accept(version: string): Promise<'browser' | 'installer'>;
}
export interface UpdateStatus {
  checking: boolean;
  updating: boolean;
  offer: UpdateOffer | null;
  notice: { title: string; message: string } | null;
  error: string | null;
}

/** One startup check across imports and page changes. No download happens on check. */
export class UpdateController {
  private started = false;
  private listeners = new Set<(state: UpdateStatus) => void>();
  state: UpdateStatus = {
    checking: false,
    updating: false,
    offer: null,
    notice: null,
    error: null,
  };
  constructor(private readonly backend: UpdateBackend) {}
  subscribe(listener: (state: UpdateStatus) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private set(patch: Partial<UpdateStatus>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
  start() {
    if (this.started) return;
    this.started = true;
    void this.check(true);
  }
  async check(quiet = false) {
    if (this.state.checking || this.state.updating) return;
    this.set({ checking: true, error: null, notice: null });
    try {
      const result = await this.backend.check();
      this.set({
        offer: result.update,
        notice:
          !quiet && !result.update
            ? {
                title: "You're up to date",
                message: `You're using DigiAtlas ${result.currentVersion}.`,
              }
            : null,
      });
    } catch (error) {
      if (!quiet)
        this.set({
          notice: {
            title: 'Unable to check for updates',
            message:
              typeof error === 'string'
                ? error
                : 'Check your internet connection and try again later.',
          },
        });
    } finally {
      this.set({ checking: false });
    }
  }
  dismiss() {
    if (!this.state.updating) this.set({ offer: null, notice: null, error: null });
  }
  async accept() {
    const offer = this.state.offer;
    if (!offer || this.state.checking || this.state.updating) return;
    this.set({ updating: true, error: null });
    try {
      const result = await this.backend.accept(offer.version);
      if (result === 'browser') this.set({ offer: null, updating: false });
    } catch (error) {
      this.set({ updating: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

export const updates = new UpdateController({
  async check() {
    return (await import('@tauri-apps/api/core')).invoke<UpdateCheck>('check_updates');
  },
  async accept(version) {
    return (await import('@tauri-apps/api/core')).invoke<'browser' | 'installer'>('accept_update', {
      version,
    });
  },
});
