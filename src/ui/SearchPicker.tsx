import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';

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
  compact = false,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  searchLabel?: string;
  closeLabel?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const positionMenu = () => {
    if (!compact || !trigger.current || !menu.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const height = Math.min(options.length * 34 + 10, 240);
    Object.assign(menu.current.style, {
      left: `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`,
      top: `${window.innerHeight - rect.bottom >= height + 8 ? rect.bottom + 4 : Math.max(8, rect.top - height - 4)}px`,
      width: `${rect.width}px`,
    });
  };
  useEffect(() => {
    if (!compact) return;
    const reposition = () => {
      if (menu.current?.matches(':popover-open')) positionMenu();
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [compact, options.length]);
  const selected = options.find((o) => o.value === value);
  const matches = options.filter(
    (o) => !o.value || o.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div class="power-field">
      <span id={`${id}-label`}>{label}</span>
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        data-picker-label={label}
        data-picker-value={value}
        class="chip-picker-trigger"
        aria-label={`Choose ${label.toLowerCase()}`}
        aria-haspopup={compact ? 'listbox' : 'dialog'}
        aria-expanded={compact ? open : undefined}
        aria-controls={compact ? id : undefined}
        popovertarget={id}
        onClick={() => {
          setQuery('');
          positionMenu();
        }}
        onKeyDown={(e) => {
          if (!compact || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
          e.preventDefault();
          positionMenu();
          menu.current?.showPopover();
        }}
      >
        <span class="picker-value">{selected?.content ?? selected?.label ?? 'None'}</span>
        <span aria-hidden="true">▾</span>
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role={compact ? 'listbox' : 'dialog'}
        aria-labelledby={`${id}-label`}
        class={compact ? 'compact-picker-menu' : 'variant-spawns chip-picker-popover'}
        onToggle={(e) => {
          if (!compact) return;
          const shown = e.currentTarget.matches(':popover-open');
          setOpen(shown);
          if (shown)
            e.currentTarget.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
        }}
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
        {!compact && (
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
        )}
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
              role={compact ? 'option' : undefined}
              aria-selected={compact ? value === option.value : undefined}
              aria-pressed={compact ? undefined : value === option.value}
              popovertarget={id}
              popovertargetaction="hide"
              onClick={() => {
                onChange(option.value);
                if (compact) trigger.current?.focus();
              }}
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
