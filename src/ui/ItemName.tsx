import type { Item } from '../data/types';
import { ELEMENT_ICONS } from './element-icons';
import { useApp } from './context';

function chipElement(item: Item | undefined) {
  if (item?.category !== 'abChip') return null;
  if (item.element) return item.element;
  return (
    (['fire', 'ice', 'thunder', 'dark'] as const).find((element) =>
      item.name.startsWith(element[0].toUpperCase() + element.slice(1) + ' '),
    ) ?? null
  );
}

export function ItemName({ itemKey }: { itemKey: string }) {
  const { model } = useApp();
  const element = chipElement(model.items.get(itemKey));
  const icon = element && ELEMENT_ICONS[element];
  return (
    <span class="item-name">
      {icon && (
        <svg
          class={`element-icon element-${element}`}
          viewBox={icon.viewBox}
          aria-hidden="true"
          focusable="false"
        >
          {icon.paths.map((d) => (
            <path d={d} />
          ))}
        </svg>
      )}
      <span>{model.itemLabel(itemKey)}</span>
    </span>
  );
}
