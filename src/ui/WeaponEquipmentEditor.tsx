import { useId, useState } from 'preact/hooks';
import {
  EQUIPMENT_RARITIES,
  equipmentRarity,
  equipmentStats,
  canEquipAttackChip,
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
  baseStrength,
  baseSpeed,
  onChange: applyChange,
}: {
  equipment: WeaponEquipment;
  baseStrength: number;
  baseSpeed: number;
  onChange: (base: number, gear: WeaponEquipment, speed: number) => void;
}) {
  const id = useId();
  const [group, setGroup] = useState<Group>('weapon');
  const { model } = useApp();
  const onChange = (base: number, gear: WeaponEquipment) => applyChange(base, gear, baseSpeed);
  const totals = equipmentStats(
    baseStrength,
    equipment,
    model.items,
    model.raw.items.saveStats,
    baseSpeed,
  );
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
              ([key, item]) =>
                item.category === category &&
                !item.unidentified &&
                (category === 'weapon' ||
                  key === value?.key ||
                  (category === 'armor2' &&
                    ((item.stats?.strength ?? 0) > 0 ||
                      model.raw.items.saveStats?.strengthBoards?.includes(item.id))) ||
                  (item.stats?.speed ?? 0) > 0 ||
                  (category === 'armor2' &&
                    model.raw.items.saveStats?.speedBoards?.includes(item.id))),
            )
            .sort(([a], [b]) => model.itemLabel(a).localeCompare(model.itemLabel(b)))
            .map(([key]) => ({
              value: key,
              label: model.itemLabel(key),
              content: <ItemName itemKey={key} />,
            })),
        ]}
      />
      {value &&
        (category === 'weapon' ||
          (category === 'armor2' &&
            (model.raw.items.saveStats?.strengthBoards?.includes(model.items.get(value.key)!.id) ||
              model.raw.items.saveStats?.speedBoards?.includes(
                model.items.get(value.key)!.id,
              )))) && (
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
    const label = slot === 'weapon' ? 'Weapon' : 'Board';
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
                if (
                  item &&
                  !canEquipAttackChip(model.items.get(item)!, slot, equipment, i, model.items)
                )
                  return;
                onChange(baseStrength, {
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
                Sub-board rarity adds to its matching main attribute: Strength or Speed.
              </p>
              <p>
                Weapon accuracy comes from your weapon. Speed bonuses from any equipped slot improve
                the hit roll. Only chips that help damage or accuracy are offered; saved equipment
                stays visible so it can be removed.
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
        <div class="equipment-base-row">
          <label class="power-field">
            Strength without equipment
            <input
              type="number"
              min="0"
              max="9999"
              step="1"
              value={baseStrength}
              onInput={(e) => {
                const n = e.currentTarget.valueAsNumber;
                if (Number.isInteger(n) && n >= 0 && n <= 9999) onChange(n, equipment);
              }}
            />
          </label>
          <label class="power-field">
            Speed without equipment
            <input
              type="number"
              min="0"
              max="9999"
              step="1"
              value={baseSpeed}
              onInput={(e) => {
                const n = e.currentTarget.valueAsNumber;
                if (Number.isInteger(n) && n >= 0 && n <= 9999)
                  applyChange(baseStrength, equipment, n);
              }}
            />
          </label>
          <dl class="equipment-totals" aria-live="polite">
            <div>
              <dt>Total Strength</dt>
              <dd>{totals.strength.toLocaleString('en-US')}</dd>
            </div>
            <div>
              <dt>Critical chance</dt>
              <dd>{totals.critChance}%</dd>
            </div>
            <div>
              <dt>Total Speed</dt>
              <dd>{totals.speed.toLocaleString('en-US')}</dd>
            </div>
          </dl>
        </div>
        <nav class="equipment-tabs" aria-label="Equipment groups">
          {(
            [
              { id: 'weapon', label: 'Weapon' },
              { id: 'board', label: 'Board' },
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
                ? 'Board equipment'
                : 'Sub board equipment'
          }
        >
          {group === 'weapon' && (
            <>
              {field('Weapon', 'weapon', equipment.weapon, (weapon) =>
                onChange(baseStrength, { ...equipment, weapon }),
              )}
              {chips('weapon')}
            </>
          )}
          {group === 'board' && (
            <>
              {field('Core', 'armor1', equipment.core, (core) =>
                onChange(baseStrength, { ...equipment, core }),
              )}
              {chips('board')}
            </>
          )}
          {group === 'sub' &&
            field('Sub board', 'armor2', equipment.subBoard, (subBoard) =>
              onChange(baseStrength, { ...equipment, subBoard }),
            )}
        </section>
      </div>
    </>
  );
}
