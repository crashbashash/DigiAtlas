import type { ComponentChildren, JSX } from 'preact';
import { formatHash, type Route } from '../app/route';
import { DIFFICULTIES, DIFFICULTY_LABEL, type Difficulty, type EnemyKind } from '../data/types';
import { useApp } from './context';
import { KIND_COLOR } from './mapview';

/** A real link to a page, so middle-click, copy link and the keyboard all work. */
export function Link({
  to,
  children,
  ...rest
}: { to: Route } & Omit<JSX.HTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const { settings } = useApp();
  return (
    <a href={formatHash(to, settings)} {...rest}>
      {children}
    </a>
  );
}

export function KindDot({ kind }: { kind: EnemyKind }) {
  return <i class="dot" style={{ background: KIND_COLOR[kind] }} aria-hidden="true" />;
}

/** A row of mutually exclusive buttons, for small choices like difficulty. */
export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  onChange(value: T): void;
}) {
  return (
    <div class="segmented" role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The settings that change the numbers. Pages pass what applies to them: a lobby has no
 * difficulty, a shop no player count.
 */
export function SettingsBar(props: {
  difficulties?: Difficulty[];
  players?: boolean;
  /** How many unused spawners there are (a stage), or `true` to offer the toggle without a count. */
  unused?: number | true;
}) {
  const { settings, setSettings } = useApp();
  const avail = props.difficulties ?? DIFFICULTIES;
  return (
    <div class="settings">
      {props.players !== false && (
        <label class="field">
          <span>Players</span>
          <select
            value={String(settings.players)}
            title="Spawn counts and drops depend on how many players are in the game"
            onChange={(e) =>
              setSettings({ players: Number((e.target as HTMLSelectElement).value) })
            }
          >
            {[1, 2, 3, 4].map((n) => (
              <option value={String(n)}>{n}</option>
            ))}
          </select>
        </label>
      )}
      {avail.length > 0 && (
        <Segmented
          label="Difficulty"
          value={settings.difficulty}
          options={DIFFICULTIES.map((d) => ({
            value: d,
            label: DIFFICULTY_LABEL[d],
            disabled: !avail.includes(d),
            title: avail.includes(d) ? undefined : 'No data for this difficulty here',
          }))}
          onChange={(difficulty) => setSettings({ difficulty })}
        />
      )}
      {(props.unused === true || (props.unused ?? 0) > 0) && (
        <label
          class="check"
          title="Spawners that no game script starts. They most likely never appear, so they are hidden unless you ask."
        >
          <input
            type="checkbox"
            checked={settings.showUnused}
            onChange={(e) => setSettings({ showUnused: (e.target as HTMLInputElement).checked })}
          />
          {props.unused === true ? 'Include unused spawners' : `Show ${props.unused} unused`}
        </label>
      )}
    </div>
  );
}

/** Settings wording for a heading: "Hard · 2 players". */
export function settingsText(difficulty: Difficulty, players: number): string {
  return `${DIFFICULTY_LABEL[difficulty]}${players > 1 ? ` · ${players} players` : ''}`;
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <p class="empty">{children}</p>;
}
