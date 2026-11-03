import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Model } from '../src/data/model';
import { DIFFICULTIES } from '../src/data/types';
import { markerRank, markersAtSpot, nextMarkerAtSpot, pickMarker, stageMarkers } from '../src/ui/markers';

it.skipIf(!process.env.DIGIATLAS_TEST_EXPORT)('can identify and select every overlapping spawn group throughout the disc', () => {
  const read = (file) => JSON.parse(readFileSync(join(process.env.DIGIATLAS_TEST_EXPORT, file), 'utf8'));
  const model = new Model({
    manifest: read('manifest.json'), enemies: read('enemies.json'), items: read('items.json'),
    stages: read('stages.json'), drops: read('drops.json'),
  });
  const project = (m) => [m.x, m.z];
  const locations = new Set();
  const differentEnemies = new Set();
  let checks = 0;
  for (const stage of model.stages) {
    for (const difficulty of DIFFICULTIES) {
      for (const players of [1, 2, 3, 4]) {
        for (const hideUnused of [true, false]) {
          const markers = stageMarkers(model, stage, difficulty, { players, hideUnused });
          const points = new Map(markers.map((m) => [`${m.x},${m.z}`, m]));
          for (const [position, spot] of points) {
            const groups = markersAtSpot(markers, spot);
            if (groups.length < 2) continue;
            locations.add(`${stage.id}:${difficulty}:${position}`);
            if (new Set(groups.map((m) => m.label)).size > 1)
              differentEnemies.add(`${stage.id}:${difficulty}:${position}`);
            let hit = pickMarker(markers, project, spot.x, spot.z, null, 12);
            expect(hit.gi).toBe([...groups].sort((a, b) => markerRank(a, null) - markerRank(b, null)).at(-1).gi);
            const first = hit.gi;
            const visited = new Set();
            for (let i = 0; i < groups.length; i++) {
              visited.add(hit.gi);
              expect(pickMarker(markers, project, spot.x, spot.z, hit.gi, 12).gi).toBe(hit.gi);
              hit = nextMarkerAtSpot(markers, hit, hit.gi);
            }
            expect(visited).toEqual(new Set(groups.map((m) => m.gi)));
            expect(hit.gi).toBe(first);
            checks++;
          }
        }
      }
    }
  }
  expect(locations.size).toBeGreaterThan(0);
  console.log(`${model.raw.manifest.platform}: ${locations.size} shared spawn positions (${differentEnemies.size} with different enemy names); ${checks} party/filter checks passed`);
}, 30000);
