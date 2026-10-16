import './style.css';
import { chooseFolder, inDesktopApp, openRemembered, type DataSource } from './data/source';
import { loadModel } from './data/model';
import { App } from './ui/app';
import { h } from './ui/dom';

const root = document.getElementById('app')!;

function message(title: string, body: string, action?: { label: string; run: () => void }): void {
  root.replaceChildren(
    h('div', { class: 'welcome' },
      h('h1', null, 'DigiAtlas'),
      h('h2', null, title),
      h('p', null, body),
      action ? h('button', { class: 'primary', onclick: action.run }, action.label) : null,
    ),
  );
}

async function start(source: DataSource): Promise<void> {
  message('Loading data…', source.label);
  try {
    const model = await loadModel(source);
    new App(root, model, source, inDesktopApp() ? pickAgain : null);
  } catch (e) {
    message('Could not load the data', String(e instanceof Error ? e.message : e), inDesktopApp() ? { label: 'Choose a different folder', run: pickAgain } : undefined);
  }
}

async function pickAgain(): Promise<void> {
  const source = await chooseFolder();
  if (source) await start(source);
}

async function boot(): Promise<void> {
  const source = await openRemembered();
  if (source) return start(source);
  message(
    'Choose your exported data',
    'DigiAtlas reads the folder written by the exporter (for example data/generated/ps2). Run `python3 -m ps2_export.export "<your Digimon World 4 USA ISO>" --out ../data/generated/ps2 --maps` from the tools folder, then pick that output folder here.',
    { label: 'Choose data folder', run: pickAgain },
  );
}

void boot();
