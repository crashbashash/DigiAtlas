import './style.css';
import { render } from 'preact';
import {
  dataState,
  desktopImporter,
  inDesktopApp,
  openData,
  requestedIso,
  requestedView,
  type DiscImporter,
} from './data/source';
import { loadModel } from './data/model';
import { App } from './ui/App';
import { DiscImport } from './ui/DiscImport';

const root = document.getElementById('app')!;

function Message(props: { title: string; body: string; action?: { label: string; run(): void } }) {
  return (
    <div class="welcome">
      <h1>DigiAtlas</h1>
      <h2>{props.title}</h2>
      <p>{props.body}</p>
      {props.action && (
        <button type="button" class="primary" onClick={props.action.run}>
          {props.action.label}
        </button>
      )}
    </div>
  );
}

async function start(): Promise<void> {
  const source = await openData();
  render(<Message title="Loading data…" body={source.label} />, root);
  try {
    const model = await loadModel(source);
    const wanted = await requestedView();
    if (wanted && wanted.startsWith('#')) history.replaceState(null, '', wanted);
    render(<App model={model} source={source} reimport={inDesktopApp() ? reimport : null} />, root);
  } catch (e) {
    render(
      <Message
        title="Could not load the data"
        body={String(e instanceof Error ? e.message : e)}
        action={inDesktopApp() ? { label: 'Import the disc again', run: () => ask() } : undefined}
      />,
      root,
    );
  }
}

/** The import screens; `start` imports that file at once, `onCancel` returns to the current data. */
let asked = 0;
function ask(opts: { stale?: string; start?: string; onCancel?: () => void } = {}): void {
  asked += 1;
  render(
    <DiscImport key={asked} importer={desktopImporter} onDone={() => void start()} {...opts} />,
    root,
  );
}

/** "Re-import from disc": the same screens, with a way back to the data already imported. */
function reimport(): void {
  ask({ onCancel: () => void start() });
}

async function boot(): Promise<void> {
  const preview = new URLSearchParams(location.search).get('import');
  if (!inDesktopApp() && preview) return showPreview(preview);
  const [state, iso] = await Promise.all([dataState(), requestedIso()]);
  if (iso)
    return ask({ start: iso, onCancel: state.state === 'ready' ? () => void start() : undefined });
  if (state.state === 'ready') return start();
  ask({ stale: state.state === 'stale' ? state.reason : undefined });
}

/**
 * Browser dev mode only: `?import=welcome|stale|failed` shows the desktop app's import screens with
 * a stand-in importer that pretends to read a disc (`failed` ends with the wrong-disc error).
 */
function showPreview(kind: string): void {
  const steps = ['Reading the game’s databases', 'Abyss of Grief · Guard Room', 'Writing the data'];
  const fake: DiscImporter = {
    choose: () => Promise.resolve('/home/you/Games/Digimon World 4 (USA).iso'),
    run: (_path, onProgress) =>
      new Promise((resolve, reject) => {
        let done = 0;
        const total = 40;
        const timer = setInterval(() => {
          done += 1;
          onProgress({ done, total, message: steps[Math.min(2, Math.floor((done * 3) / total))] });
          if (kind === 'failed' && done === 3) {
            clearInterval(timer);
            reject(new Error('this does not look like a Digimon World 4 disc (missing NDMW.AFS)'));
          } else if (done === total) {
            clearInterval(timer);
            resolve();
          }
        }, 150);
      }),
  };
  render(
    <DiscImport
      importer={fake}
      stale={
        kind === 'stale' ? 'DigiAtlas has been updated since your disc was imported.' : undefined
      }
      onDone={() => void start()}
    />,
    root,
  );
}

void boot();
