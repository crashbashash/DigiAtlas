import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Model } from '../src/data/model';
import { dropTable, itemKey } from '../src/data/logic';
import { DIFFICULTIES } from '../src/data/types';

it.skipIf(!process.env.DIGIATLAS_CROWN_DROPS_EXPORT)('shows the patched drop distributions and every party/difficulty loot link', () => {
  const read = (file) => JSON.parse(readFileSync(join(process.env.DIGIATLAS_CROWN_DROPS_EXPORT, file), 'utf8'));
  const model = new Model({
    manifest: read('manifest.json'), enemies: read('enemies.json'), items: read('items.json'),
    stages: read('stages.json'), drops: read('drops.json'),
  });
  expect(model.raw.manifest.mod.options.betterLoot).toBe(true);
  const expectedTargets = new Map([
    [8899, [5000, 1500, 100, 2300, 1100]],
    [8799, [5000, 2000, 200, 1600, 1200]],
    [9199, [5000, 2500, 300, 1400, 800]],
  ]);
  const category = (entry) => {
    if (['weapon', 'armor1', 'armor2', 'abChip'].includes(entry.category)) return 0;
    if (entry.category === 'insItem' && entry.id >= 1 && entry.id <= 3) return 1;
    if (entry.category === 'insItem' && entry.id >= 4 && entry.id <= 25) return 2;
    return 3;
  };
  const tables = new Map();
  let rebalanced = 0;
  for (const [key, pool] of Object.entries(model.pools)) {
    expect(pool.roll).toBe('inclusive');
    const outcomes = new Map();
    let nothing = 0;
    // Independent oracle: execute every possible retail roll against the ordered raw weights.
    for (let roll = 0; roll < 10000; roll++) {
      let value = roll;
      let found = false;
      for (const entry of pool.entries) {
        value -= entry.rate;
        if (value <= 0) {
          const item = itemKey(entry.category, entry.id);
          outcomes.set(item, (outcomes.get(item) ?? 0) + 1);
          found = true;
          break;
        }
      }
      if (!found) nothing++;
    }
    const table = dropTable(pool);
    expect(new Map(table.rows.map((r) => [r.key, r.rate])), key).toEqual(outcomes);
    expect(table.nothingPercent, key).toBe(nothing / 100);
    tables.set(key, table);
    const targets = expectedTargets.get(pool.totalRate);
    if (targets) {
      const groups = [0, 0, 0, 0, nothing];
      for (const row of table.rows) groups[category(row)] += row.rate;
      expect(groups, key).toEqual(targets);
      rebalanced++;
    }
  }
  let links = 0;
  let guaranteed = 0;
  for (const stage of model.raw.stages.stages) {
    for (const difficulty of DIFFICULTIES) {
      for (const players of [1, 2, 3, 4]) {
        for (const g of model.generators(stage, difficulty, { players, hideUnused: false })) {
          for (const last of [false, true]) {
            const key = (last ? g.lastDrops : g.drops)?.[difficulty];
            if (!key) continue;
            expect(model.tableFor(g, difficulty, last)).toEqual(tables.get(key));
            if (model.poolFor(g, difficulty, last).entries.some((e) => e.category === 'impItem' && e.rate >= 10000)) {
              expect(model.tableFor(g, difficulty, last).nothingPercent).toBe(0);
              guaranteed++;
            }
            links++;
          }
        }
      }
    }
  }
  expect(rebalanced).toBeGreaterThan(100);
  expect(guaranteed).toBeGreaterThan(0);
  expect(links).toBeGreaterThan(10000);
  console.log(`${model.raw.manifest.platform}: ${tables.size} pools checked over all 10000 rolls; ${rebalanced} Crown Drops distributions; ${links} UI loot links; ${guaranteed} guaranteed rewards`);
}, 30000);
