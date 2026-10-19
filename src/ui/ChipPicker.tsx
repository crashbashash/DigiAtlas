import { useApp } from './context';
import { ItemName } from './ItemName';
import { SearchPicker } from './SearchPicker';
import { canEquipAttackChip, type WeaponEquipment } from '../data/weapon-equipment';

export function ChipPicker({
  label,
  value,
  slot,
  equipment,
  index,
  onChange,
}: {
  label: string;
  value: string | null;
  slot: 'weapon' | 'board';
  equipment: WeaponEquipment;
  index: number;
  onChange: (key: string | null) => void;
}) {
  const { model } = useApp();
  const chips = [...model.items.entries()]
    .filter(([, i]) => i.category === 'abChip' && !i.unidentified && i.name !== 'Sold Out')
    .filter(
      ([key, item]) =>
        key === value || canEquipAttackChip(item, slot, equipment, index, model.items),
    )
    .sort(([a], [b]) => model.itemLabel(a).localeCompare(model.itemLabel(b)));
  return (
    <SearchPicker
      label={label}
      value={value ?? ''}
      searchLabel="Search chips"
      closeLabel="Close chip picker"
      onChange={(key) => onChange(key || null)}
      options={[
        { value: '', label: 'None' },
        ...chips.map(([key]) => ({
          value: key,
          label: model.itemLabel(key),
          content: <ItemName itemKey={key} />,
        })),
      ]}
    />
  );
}
