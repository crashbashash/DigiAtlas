import type { ComponentChildren } from 'preact';
import { useId, useState } from 'preact/hooks';

export interface PickerOption {
  value: string;
  label: string;
  content?: ComponentChildren;
}

/** Shared searchable selection UI for equipment, chips and rarity. */
export function SearchPicker({
  label,
  value,
  options,
  onChange,
  searchLabel,
  disabled = false,
  closeLabel = 'Close picker',
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  searchLabel?: string;
  closeLabel?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value);
  const matches = options.filter(
    (o) => !o.value || o.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div class="power-field">
      <span id={`${id}-label`}>{label}</span>
      <button
        type="button"
        disabled={disabled}
        data-picker-label={label}
        data-picker-value={value}
        class="chip-picker-trigger"
        aria-label={`Choose ${label.toLowerCase()}`}
        aria-haspopup="dialog"
        popovertarget={id}
        onClick={() => setQuery('')}
      >
        <span class="picker-value">{selected?.content ?? selected?.label ?? 'None'}</span>
        <span aria-hidden="true">▾</span>
      </button>
      <div
        id={id}
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-label`}
        class="variant-spawns chip-picker-popover"
        onKeyDown={(e) => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
          if (e.target instanceof HTMLInputElement && ['Home', 'End'].includes(e.key)) return;
          const choices = Array.from(
            e.currentTarget.querySelectorAll<HTMLButtonElement>('.chip-option'),
          );
          if (!choices.length) return;
          const index = choices.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? choices.length - 1
                : e.key === 'ArrowDown'
                  ? Math.min(index + 1, choices.length - 1)
                  : index < 0
                    ? choices.length - 1
                    : Math.max(index - 1, 0);
          e.preventDefault();
          choices[next].focus();
        }}
      >
        <header class="variant-spawns-head">
          <h2>{label}</h2>
          <button
            type="button"
            class="link"
            popovertarget={id}
            popovertargetaction="hide"
            aria-label={closeLabel}
          >
            ✕
          </button>
        </header>
        {searchLabel && (
          <label class="power-field">
            {searchLabel}
            <input
              type="search"
              autoFocus
              value={query}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
          </label>
        )}
        <div class="chip-options">
          {matches.map((option) => (
            <button
              key={option.value}
              data-picker-option-value={option.value}
              data-picker-option-label={option.label}
              type="button"
              class="chip-option"
              aria-pressed={value === option.value}
              popovertarget={id}
              popovertargetaction="hide"
              onClick={() => onChange(option.value)}
            >
              {option.content ?? option.label}
              {value === option.value && <span aria-hidden="true">✓</span>}
            </button>
          ))}
          {matches.every((o) => !o.value) && query.trim() && (
            <p class="muted">No matching items.</p>
          )}
        </div>
      </div>
    </div>
  );
}
