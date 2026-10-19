import { useEffect, useRef, useState } from 'preact/hooks';
import { inDesktopApp } from '../data/source';
import { updates } from '../data/updates';

export function UpdateCenter({ blocked = false }: { blocked?: boolean }) {
  const [state, setState] = useState(updates.state);
  const dialog = useRef<HTMLDialogElement>(null);
  const desktop = inDesktopApp();
  useEffect(() => {
    if (!desktop) return;
    const unsubscribe = updates.subscribe(setState);
    updates.start();
    return unsubscribe;
  }, [desktop]);
  const visible = (!blocked || state.updating) && !!(state.offer || state.notice);
  useEffect(() => {
    if (visible && !dialog.current?.open) dialog.current?.showModal();
    if (!visible && dialog.current?.open) dialog.current.close();
  }, [visible]);
  if (!desktop) return null;
  const offer = state.offer;
  return (
    <>
      <button
        type="button"
        class="update-check"
        disabled={blocked || state.checking || state.updating}
        onClick={() => void updates.check()}
      >
        {state.checking ? 'Checking for updates…' : 'Check for updates'}
      </button>
      <dialog
        ref={dialog}
        class="update-dialog"
        aria-labelledby="update-title"
        onCancel={(e) => {
          e.preventDefault();
          updates.dismiss();
        }}
      >
        {offer ? (
          <>
            <h2 id="update-title">Update available</h2>
            <p>
              DigiAtlas {offer.version} is available. You’re using {offer.currentVersion}.
            </p>
            <div class="update-notes" role="region" aria-label="What's new" tabIndex={0}>
              {offer.releases.map((release) => (
                <section key={release.version}>
                  <h3>Version {release.version}</h3>
                  <div class="release-notes">{release.notes}</div>
                </section>
              ))}
            </div>
            <p class="muted">
              {offer.method === 'msi'
                ? 'Download and open Windows Installer? DigiAtlas will close when the installer starts.'
                : 'Open the GitHub release page to download the update?'}
            </p>
            {state.error && (
              <p class="update-error" role="alert">
                {state.error}
              </p>
            )}
            {state.updating && (
              <p role="status">
                {offer.method === 'msi'
                  ? 'Downloading and verifying the update…'
                  : 'Opening the release page…'}
              </p>
            )}
            <div class="update-actions">
              <button type="button" disabled={state.updating} onClick={() => updates.dismiss()}>
                Later
              </button>
              <button
                type="button"
                class="primary"
                disabled={state.updating}
                onClick={() => void updates.accept()}
              >
                {offer.method === 'msi' ? 'Download and update' : 'Open GitHub release'}
              </button>
            </div>
          </>
        ) : (
          state.notice && (
            <>
              <h2 id="update-title">{state.notice.title}</h2>
              <p>{state.notice.message}</p>
              <div class="update-actions">
                <button type="button" onClick={() => updates.dismiss()}>
                  Close
                </button>
              </div>
            </>
          )
        )}
      </dialog>
    </>
  );
}
