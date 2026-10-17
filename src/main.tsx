import './style.css';
import { render } from 'preact';
import {
  chooseFolder,
  inDesktopApp,
  openRemembered,
  requestedView,
  type DataSource,
} from './data/source';
import { loadModel } from './data/model';
import { App } from './ui/App';

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

async function start(source: DataSource): Promise<void> {
  render(<Message title="Loading data…" body={source.label} />, root);
  try {
    const model = await loadModel(source);
    const wanted = await requestedView();
    if (wanted && wanted.startsWith('#')) history.replaceState(null, '', wanted);
    render(
      <App model={model} source={source} changeData={inDesktopApp() ? pickAgain : null} />,
      root,
    );
  } catch (e) {
    render(
      <Message
        title="Could not load the data"
        body={String(e instanceof Error ? e.message : e)}
        action={inDesktopApp() ? { label: 'Choose a different folder', run: pickAgain } : undefined}
      />,
      root,
    );
  }
}

async function pickAgain(): Promise<void> {
  const source = await chooseFolder();
  if (source) await start(source);
}

async function boot(): Promise<void> {
  const source = await openRemembered();
  if (source) return start(source);
  render(
    <Message
      title="Choose your exported data"
      body='DigiAtlas reads the folder written by the exporter (for example data/generated/ps2). Run `python3 -m ps2_export.export "<your Digimon World 4 USA ISO>" --out ../data/generated/ps2 --maps` from the tools folder, then pick that output folder here.'
      action={{ label: 'Choose data folder', run: pickAgain }}
    />,
    root,
  );
}

void boot();
