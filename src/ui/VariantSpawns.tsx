import { useId } from 'preact/hooks';
import { routes } from '../app/route';
import { DIFFICULTY_LABEL, type Enemy } from '../data/types';
import { Link } from './common';
import { useApp } from './context';
import { variantLabel } from './pieces';

/** Native popover: dismiss with Escape, the close button or a click outside. */
export function VariantSpawns({ enemy }: { enemy: Enemy }) {
  const id = useId();
  const { model, settings, scope } = useApp();
  const spawns = model.rowSpawns(enemy.row, settings.difficulty, scope);
  return (
    <>
      <button type="button" class="link" popovertarget={id} aria-haspopup="dialog">
        View spawns
      </button>
      <div
        id={id}
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-title`}
        class="variant-spawns"
      >
        <header class="variant-spawns-head">
          <h2 id={`${id}-title`}>{enemy.name} spawns</h2>
          <button
            type="button"
            class="link"
            popovertarget={id}
            popovertargetaction="hide"
            aria-label="Close spawn locations"
          >
            ✕
          </button>
        </header>
        <p class="muted">
          {variantLabel(enemy)} · {DIFFICULTY_LABEL[settings.difficulty]}
        </p>
        {spawns.length ? (
          <ul class="variant-spawns-list">
            {spawns.map((s) => (
              <li key={s.stage.id}>
                <Link to={routes.map(s.stage.id, { kind: 'group', row: enemy.row }, true)}>
                  <strong>{model.stageTitle(s.stage)}</strong>
                  {s.stage.area && <small>{s.stage.area}</small>}
                </Link>
                <span class="muted">
                  {s.total} {s.total === 1 ? 'enemy' : 'enemies'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No spawns for this variant on {DIFFICULTY_LABEL[settings.difficulty]}.</p>
        )}
      </div>
    </>
  );
}
