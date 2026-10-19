import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';

export function FormulaHelp({
  title,
  children,
  example,
  footer,
  terms = [],
}: {
  title: string;
  children: ComponentChildren;
  example?: ComponentChildren;
  footer?: ComponentChildren;
  terms?: ('floor' | 'truncate' | 'clamp' | 'max')[];
}) {
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
        {terms.length > 0 && (
          <p>
            {terms.map((term, index) => (
              <span key={term}>
                {index > 0 && ' '}
                <strong>{term}</strong>{' '}
                {
                  {
                    floor: 'rounds down to a whole number.',
                    truncate: 'removes the fractional part, rounding towards zero.',
                    clamp: 'keeps a value between the specified lower and upper limits.',
                    max: 'uses the larger of its values.',
                  }[term]
                }
              </span>
            ))}
          </p>
        )}
        {example && (
          <section class="formula-example" aria-label="Current example">
            <h3>Current example</h3>
            {example}
          </section>
        )}
        {footer && <footer class="formula-footer">{footer}</footer>}
      </div>
    </>
  );
}
