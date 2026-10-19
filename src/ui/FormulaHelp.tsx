import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';

export function FormulaHelp({ title, children }: { title: string; children: ComponentChildren }) {
  const id = useId();
  return (
    <>
      <button
        type="button"
        class="formula-help"
        popovertarget={id}
        aria-haspopup="dialog"
        aria-label={`Show ${title.toLowerCase()}`}
      >
        ?
      </button>
      <div
        id={id}
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-title`}
        class="variant-spawns formula-popover"
      >
        <header class="variant-spawns-head">
          <h2 id={`${id}-title`}>{title}</h2>
          <button
            type="button"
            class="link"
            popovertarget={id}
            popovertargetaction="hide"
            aria-label="Close formula"
          >
            ✕
          </button>
        </header>
        {children}
      </div>
    </>
  );
}
