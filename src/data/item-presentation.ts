import type { Item } from './types';

// insItem.NOURYOKU keys, verified against the disc database and permanent stat slots.
const PICKUP_STATS: Record<string, string> = {
  tuyosa: 'Strength',
  mamori: 'Defense',
  maxhp: 'Max HP',
  maxmp: 'Max MP',
  kashikosa: 'Wisdom',
  seishin: 'Spirit',
  subayasa: 'Speed',
  fire: 'Fire Resistance',
  ice: 'Ice Resistance',
  thunder: 'Thunder Resistance',
  dark: 'Dark Resistance',
};
const LEGACY_STATS: Record<string, string> = {
  'Strgth.': 'Strength',
  'Def.': 'Defense',
  MaxHP: 'Max HP',
  MaxMP: 'Max MP',
  Wisdom: 'Wisdom',
  Spirit: 'Spirit',
  Speed: 'Speed',
  '⊂': 'Fire Resistance',
  '⊃': 'Ice Resistance',
  '∪': 'Thunder Resistance',
  '∩': 'Dark Resistance',
};

/** Explain immediate pickups without changing their identity or the imported game text. */
export function presentPickup(item: Item): Item {
  if (item.category !== 'insItem') return item;
  const effect = item.pickup;
  const amount =
    effect && Number.isInteger(effect.amount) && effect.amount > 0 ? effect.amount : null;
  const original = item.name;
  let name = original;
  let explanation = '';
  if (effect?.attribute === 'bit' || (!effect && original === 'BIT')) {
    explanation =
      'Currency collected on pickup. Spend BIT at shops and other services in the Home Server.';
  } else if (effect?.attribute === 'xdata' || (!effect && original === 'X-Data')) {
    name = amount === null ? 'X-Data' : `X-Data (+${amount})`;
    explanation = `${amount === null ? 'Collects X-Data' : `Adds ${amount} X-Data`} on pickup. Spend X-Data at the Data Keeper in the Home Server to permanently increase your Digimon’s stats or upgrade Ability Chips.`;
  } else {
    // Older browser exports have no pickup values. Explain the stat without guessing its amount.
    const legacyStat = original.match(/^(.*?)\s*↑\s*Plug$/)?.[1];
    const stat = effect ? PICKUP_STATS[effect.attribute] : legacyStat && LEGACY_STATS[legacyStat];
    if (stat) {
      name = `Permanent ${stat} Buff${amount === null ? '' : ` (+${amount})`}`;
      explanation = `Permanently increases the collecting Digimon’s ${stat}${amount === null ? '' : ` by ${amount}`} on pickup.`;
    }
  }
  if (!explanation) return item;
  return {
    ...item,
    name,
    description: [explanation, item.description].filter(Boolean).join('\n\n'),
  };
}
