import { useEffect, useState } from 'preact/hooks';
import { UpdateCenter } from './UpdateCenter';
import type { DiscImporter, ImportProgress } from '../data/source';

type Phase =
  | { kind: 'intro' }
  | { kind: 'importing'; file: string; progress: ImportProgress | null }
  | { kind: 'failed'; file: string | null; message: string };

const LOAD_LABEL = 'Load your Digimon World 4 disc image (PS2 or GameCube)';

/** An error as a sentence (the importer's messages start in lower case). */
export function errorText(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The file name of a path from any OS. */
const fileName = (path: string): string => path.split(/[\\/]/).pop() || path;

/** Done steps as a whole percentage, never past 100. */
export function percent(p: ImportProgress | null): number {
  if (!p || p.total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((p.done / p.total) * 100)));
}

/**
 * Asks for the disc image and imports it: the first screen of a fresh install, and the way back
 * when the data is stale or the user re-imports. `start` imports that file straight away.
 */
export function DiscImport(props: {
  importer: DiscImporter;
  /** Why the current data cannot be shown (an importer update), if there is any. */
  stale?: string;
  start?: string;
  onDone(): void;
  /** Go back to the data already imported (when there is some to go back to). */
  onCancel?: () => void;
}) {
  const { importer, stale, start, onDone, onCancel } = props;
  const [phase, setPhase] = useState<Phase>(
    start ? { kind: 'importing', file: start, progress: null } : { kind: 'intro' },
  );

  const run = async (file: string): Promise<void> => {
    setPhase({ kind: 'importing', file, progress: null });
    try {
      await importer.run(file, (progress) => setPhase({ kind: 'importing', file, progress }));
      onDone();
    } catch (e) {
      setPhase({ kind: 'failed', file, message: errorText(e) });
    }
  };

  const choose = async (): Promise<void> => {
    try {
      const file = await importer.choose();
      if (file) await run(file);
    } catch (e) {
      setPhase({ kind: 'failed', file: null, message: errorText(e) });
    }
  };

  useEffect(() => {
    if (start) void run(start);
  }, []);

  if (phase.kind === 'importing') {
    const pct = percent(phase.progress);
    return (
      <div class="welcome disc-import">
        <h1>DigiAtlas</h1>
        <UpdateCenter blocked />
        <h2>Importing your disc</h2>
        <p class="muted import-file">{fileName(phase.file)}</p>
        <div
          class="import-bar"
          role="progressbar"
          aria-label="Import progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div style={{ width: `${pct}%` }} />
        </div>
        <p class="import-step">
          <span>{phase.progress?.message ?? 'Opening the disc image'}</span>
          <span class="import-percent">{pct}%</span>
        </p>
        <p class="muted import-note">This takes a minute or two. Keep DigiAtlas open.</p>
      </div>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <div class="welcome disc-import">
        <h1>DigiAtlas</h1>
        <UpdateCenter />
        <h2>The disc could not be imported</h2>
        <p class="import-error" role="alert">
          {phase.message}
        </p>
        {phase.file && <p class="muted import-file">{phase.file}</p>}
        <div class="import-actions">
          <button type="button" class="primary" onClick={() => void choose()}>
            Choose another file
          </button>
          {onCancel && (
            <button type="button" class="link" onClick={onCancel}>
              Keep the current data
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div class="welcome disc-import">
      <h1>DigiAtlas</h1>
      <UpdateCenter />
      {onCancel && !stale ? (
        <>
          <h2>Import your disc again</h2>
          <p>
            Read the disc image again, for example after replacing it. The data you have now stays
            until the new import has finished.
          </p>
        </>
      ) : stale ? (
        <>
          <h2>Your data needs refreshing</h2>
          <p>
            {stale} Load your disc image again to refresh the maps, drops and stats; it takes a
            minute or two.
          </p>
        </>
      ) : (
        <>
          <h2>Maps, drops and stats for Digimon World 4</h2>
          <p>
            Enemy stats, spawn locations and item drops on interactive maps, read from your own copy
            of the game.
          </p>
        </>
      )}
      <div class="import-actions">
        <button type="button" class="primary" onClick={() => void choose()}>
          {LOAD_LABEL}
        </button>
        {onCancel && (
          <button type="button" class="link" onClick={onCancel}>
            Back
          </button>
        )}
      </div>
      <p class="muted import-note">
        DigiAtlas reads the disc once and keeps the data, so you can move or delete the image
        afterwards.
      </p>
    </div>
  );
}
