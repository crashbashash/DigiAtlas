import { useEffect, useId, useState } from 'preact/hooks';
import {
  EQUIPMENT_BONUS_MAX,
  validEquipmentBonus,
  type EquippedItem,
} from '../data/weapon-equipment';

export function EquipmentBonusInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: EquippedItem;
  onChange: (value: EquippedItem) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value.revision));
  useEffect(() => setDraft(String(value.revision)), [value]);
  const invalid = !draft.trim() || !validEquipmentBonus(Number(draft));
  return (
    <div class="equipment-exact-bonus">
      <label class="power-field">
        Exact bonus (+N)
        <input
          aria-label={`${label} exact bonus`}
          type="number"
          min="0"
          max={EQUIPMENT_BONUS_MAX}
          step="1"
          value={draft}
          aria-invalid={invalid}
          aria-describedby={id}
          onInput={(e) => {
            const next = e.currentTarget.value;
            setDraft(next);
            const bonus = e.currentTarget.valueAsNumber;
            if (validEquipmentBonus(bonus)) onChange({ ...value, revision: bonus });
          }}
        />
      </label>
      <p id={id} class="equipment-bonus-hint" role={invalid ? 'alert' : undefined}>
        {invalid
          ? `Enter a whole number from 0 to ${EQUIPMENT_BONUS_MAX}. Using the last valid bonus (+${value.revision}).`
          : `Whole number from 0 to ${EQUIPMENT_BONUS_MAX}.`}
      </p>
    </div>
  );
}
