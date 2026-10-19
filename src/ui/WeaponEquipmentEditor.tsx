import { useId, useState } from 'preact/hooks';
import {
  EQUIPMENT_RARITIES,
  equipmentRarity,
  canEquipChip,
  type EquippedItem,
  type WeaponEquipment,
} from '../data/weapon-equipment';
import { useApp } from './context';
import { ChipPicker } from './ChipPicker';
import { SearchPicker } from './SearchPicker';
import { ItemName } from './ItemName';
import { FormulaHelp } from './FormulaHelp';

type Group = 'weapon' | 'board' | 'sub';
export function WeaponEquipmentEditor({
  equipment,
  onChange,
}: {
  equipment: WeaponEquipment;
  onChange: (gear: WeaponEquipment) => void;
}) {
  const id = useId();
  const [group, setGroup] = useState<Group>('weapon');
  const { model } = useApp();
  const field = (
    label: string,
    category: string,
    value: EquippedItem | null,
    update: (item: EquippedItem | null) => void,
  ) => (
    <div class="equipment-row">
      <SearchPicker
        label={label}
        value={value?.key ?? ''}
        searchLabel={`Search ${label.toLowerCase()}`}
        closeLabel="Close equipment picker"
        onChange={(key) => update(key ? { key, revision: 0 } : null)}
        options={[
          { value: '', label: 'None' },
          ...[...model.items.entries()]
            .filter(
              ([, item]) =>
                item.category === category && !item.unidentified && item.name !== 'Sold Out',
            )
            .sort(([a], [b]) => model.itemLabel(a).localeCompare(model.itemLabel(b)))
            .map(([key]) => ({
              value: key,
              label: model.itemLabel(key),
              content: <ItemName itemKey={key} />,
            })),
        ]}
      />
      {value && (
        <SearchPicker
          label={`${label} rarity`}
          value={equipmentRarity(value.revision).name}
          closeLabel="Close rarity picker"
          onChange={(name) =>
            update({
              ...value,
              revision: EQUIPMENT_RARITIES.find((r) => r.name === name)!.minimum,
            })
          }
          options={EQUIPMENT_RARITIES.map((r) => ({
            value: r.name,
            label: r.name,
            content: (
              <span class="rarity-choice">
                <span class="rarity-dot" style={{ background: r.color }} aria-hidden="true" />
                <span style={{ color: r.color }}>{r.name}</span>
              </span>
            ),
          }))}
        />
      )}
    </div>
  );
  const chips = (slot: 'weapon' | 'board') => {
    const key = slot === 'weapon' ? 'weaponChips' : 'boardChips';
    const label = slot === 'weapon' ? 'Weapon' : 'Core';
    return (
      <section class="equipment-chips" aria-label={`${label} chips`}>
        <h3>
          Chips <span class="muted">{equipment[key].filter(Boolean).length} / 5</span>
        </h3>
        <div class="equipment-chip-grid">
          {equipment[key].map((chip, i) => (
            <ChipPicker
              key={i}
              slot={slot}
              equipment={equipment}
              index={i}
              label={`${label} chip ${i + 1}`}
              value={chip?.key ?? null}
              onChange={(item) => {
                if (item && !canEquipChip(model.items.get(item)!, slot, equipment, i, model.items))
                  return;
                onChange({
                  ...equipment,
                  [key]: equipment[key].map((c, index) =>
                    index === i ? (item ? { key: item, revision: 0 } : null) : c,
                  ),
                });
              }}
            />
          ))}
        </div>
      </section>
    );
  };
  return (
    <>
      <button type="button" class="equipment-edit-button" popovertarget={id} aria-haspopup="dialog">
        Change equipment
      </button>
      <div
        id={id}
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-title`}
        class="variant-spawns equipment-popover"
      >
        <header class="variant-spawns-head">
          <div class="formula-heading">
            <h2 id={`${id}-title`}>Equipment</h2>
            <FormulaHelp title="Equipment bonuses">
              <p>
                Attack Strength uses your base Strength, weapon, weapon chips and sub board.
                Sub-board rarity adds to its matching main attribute: Strength, Speed or Wisdom.
              </p>
              <p>
                Weapon accuracy comes from your weapon. Speed bonuses from any equipped slot improve
                the hit roll. All chips compatible with the selected slot are offered, including
                chips that do not affect this calculator.
              </p>
              <p>
                New rarity selections use the lowest bonus for that colour. Loaded saves keep their
                exact bonus.
              </p>
            </FormulaHelp>
          </div>
          <button
            type="button"
            class="link"
            popovertarget={id}
            popovertargetaction="hide"
            aria-label="Close equipment"
          >
            ✕
          </button>
        </header>
        <nav class="equipment-tabs" aria-label="Equipment groups">
          {(
            [
              { id: 'weapon', label: 'Weapon' },
              { id: 'board', label: 'Core' },
              { id: 'sub', label: 'Sub board' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={group === t.id}
              onClick={() => setGroup(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <section
          class="equipment-group"
          aria-label={
            group === 'weapon'
              ? 'Weapon equipment'
              : group === 'board'
                ? 'Core equipment'
                : 'Sub board equipment'
          }
        >
          {group === 'weapon' && (
            <>
              {field('Weapon', 'weapon', equipment.weapon, (weapon) =>
                onChange({ ...equipment, weapon }),
              )}
              {chips('weapon')}
            </>
          )}
          {group === 'board' && (
            <>
              {field('Core', 'armor1', equipment.core, (core) => onChange({ ...equipment, core }))}
              {chips('board')}
            </>
          )}
          {group === 'sub' &&
            field('Sub board', 'armor2', equipment.subBoard, (subBoard) =>
              onChange({ ...equipment, subBoard }),
            )}
        </section>
      </div>
    </>
  );
}
