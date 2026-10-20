import { describe, expect, it } from 'vitest';
import { presentPickup } from './item-presentation';
import { Model } from './model';
import { search } from './search';
import type { Item, RawData } from './types';

const pickup = (attribute: string, amount: number, name = '∩↑Plug'): Item => ({
  category: 'insItem',
  id: 24,
  name,
  description: null,
  pickup: { attribute, amount },
});

describe('immediate pickup explanations', () => {
  it('distinguishes X-Data amounts and explains where to use them', () => {
    for (const amount of [5, 20, 100]) {
      const item = presentPickup(pickup('xdata', amount, 'X-Data'));
      expect(item.name).toBe(`X-Data (+${amount})`);
      expect(item.description).toContain(`Adds ${amount} X-Data on pickup`);
      expect(item.description).toContain('Data Keeper');
    }
  });

  it('reads effect amounts rather than inferring power from item IDs', () => {
    const source = pickup('dark', 7);
    expect(presentPickup(source)).toMatchObject({
      name: 'Permanent Dark Resistance Buff (+7)',
      description: 'Permanently increases the collecting Digimon’s Dark Resistance by 7 on pickup.',
    });
    expect(source.name).toBe('∩↑Plug');
    expect(source.description).toBeNull();
    for (const [key, stat] of Object.entries({
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
    })) {
      expect(presentPickup(pickup(key, 2)).name).toBe(`Permanent ${stat} Buff (+2)`);
    }
  });

  it('explains older exports without inventing amounts and retains imported descriptions', () => {
    expect(
      presentPickup({ category: 'insItem', id: 24, name: '∩↑Plug', description: 'Disc text' }),
    ).toMatchObject({
      name: 'Permanent Dark Resistance Buff',
      description:
        'Permanently increases the collecting Digimon’s Dark Resistance on pickup.\n\nDisc text',
    });
    expect(presentPickup(pickup('bit', 0, 'BIT')).description).toContain('Currency');
    const unknown = pickup('unknown', 5, 'Mystery');
    expect(presentPickup(unknown)).toBe(unknown);
    const weapon = { ...pickup('dark', 2), category: 'weapon' };
    expect(presentPickup(weapon)).toBe(weapon);
  });

  it('uses effect labels throughout the model while retaining original names for search', () => {
    const raw: RawData = {
      manifest: {
        schemaVersion: 1,
        platform: 'ps2',
        region: 'usa',
        serial: null,
        counts: {},
        knownGaps: [],
      },
      items: { items: [pickup('dark', 1), { ...pickup('dark', 2), id: 25 }] },
      enemies: { rows: [] },
      drops: { pools: {} },
      stages: { stages: [] },
    };
    const model = new Model(raw);
    expect(model.itemLabel('insItem:24')).toBe('Permanent Dark Resistance Buff (+1)');
    expect(model.itemLabel('insItem:25')).toBe('Permanent Dark Resistance Buff (+2)');
    expect(model.itemOriginalName('insItem:24')).toBe('∩↑Plug');
    expect(search(model, 'Dark Resistance').items).toHaveLength(2);
    expect(search(model, 'Plug').items).toHaveLength(2);
    expect(raw.items.items[0].name).toBe('∩↑Plug');
  });
});
