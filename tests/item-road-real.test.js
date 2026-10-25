import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Model } from '../src/data/model';
import { stageMarkers } from '../src/ui/markers';

// Run against an existing disc export without committing game data.
it.skipIf(!process.env.DIGIATLAS_TEST_EXPORT)('shows Item Road chests and loot on every difficulty', () => {
  const read = (file) => JSON.parse(readFileSync(join(process.env.DIGIATLAS_TEST_EXPORT, file), 'utf8'));
  const model = new Model({
    manifest: read('manifest.json'), enemies: read('enemies.json'), items: read('items.json'),
    stages: read('stages.json'), drops: read('drops.json'),
  });
  const first = model.byId.get('dngq7b1e');
  expect(model.mapDifficulties(first)).toEqual(['normal', 'hard', 'veryhard']);
  expect(model.entryDifficulty(first)).toBeNull();
  for (const [difficulty, prefix, count, weapon] of [
    ['normal', 'E', 32, 109], ['hard', 'H', 32, 119], ['veryhard', 'V', 44, 124],
  ]) {
    for (const id of ['dngq7b1e', 'dngq7b2e']) {
      const stage = model.byId.get(id);
      expect(model.stagesOn(difficulty)).toContain(stage);
      expect(model.stageOn(stage, difficulty)).toBe(stage);
    }
    const hidden = model.hidden(first, difficulty);
    const chests = model.generators(first, difficulty)
      .filter((g, i) => g.name.startsWith('GBOX-') && !hidden.has(i));
    expect(chests).toHaveLength(count);
    expect(chests.every((g) => g.name.startsWith(`GBOX-${prefix}`))).toBe(true);
    const generators = model.generators(first, difficulty);
    const scope = { players: 1, hideUnused: true };
    const pins = stageMarkers(model, first, difficulty, scope)
      .filter((m) => generators[m.gi].name.startsWith('GBOX-'));
    expect(pins).toHaveLength(count);
    for (const pin of pins) {
      const chest = generators[pin.gi];
      expect(chest.name.startsWith(`GBOX-${prefix}`)).toBe(true);
      expect(model.tableFor(chest, difficulty).rows.length).toBeGreaterThan(0);
    }
    const allPins = stageMarkers(model, first, difficulty, { ...scope, hideUnused: false });
    expect(allPins.filter((m) => generators[m.gi].name.startsWith('GBOX-'))).toHaveLength(108);
    expect(allPins.filter((m) => generators[m.gi].name.startsWith('GBOX-') && !m.unused)).toHaveLength(count);
    const sources = model.sourcesOf(`weapon:${weapon}`, difficulty)
      .filter((s) => s.stage.id === 'dngq7b2e');
    expect(sources.some((s) => s.percent === 8)).toBe(true);
  }
});
