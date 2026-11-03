import { describe, expect, it } from 'vitest';
import type { Enemy, Generator } from '../data/types';
import { makeMarkers, markersAtSpot, nextMarkerAtSpot, pickMarker } from './markers';
import { startSummary } from '../data/logic';

const enemy = (row: number, kind: Enemy['kind'] = 'enemy'): Enemy => ({
  row,
  name: `E${row}`,
  kind,
  model: 'm',
  hp: 100,
  stats: { strength: 1, defense: 1, wisdom: 1, spirit: 1, speed: 1, exp: 1 },
  resist: { fire: 0, ice: 0, thunder: 0, dark: 0, stun: 0, poison: 0 },
  rates: { crit: 0, paralysis: 0 },
  rarity: 0,
});
const gen = (row: number, count: number | null, spots: [number, number][]): Generator => ({
  name: 'G',
  row,
  count,
  maxCount: count,
  spawns: spots.map(([x, z]) => [x, 0, z] as [number, number, number]),
  rotations: [],
  startMode: 'direct',
  fillMode: 'wipeout',
});
const enemies = new Map([
  [1, enemy(1)],
  [9, enemy(9, 'object')],
]);

describe('overlapping spawn groups', () => {
  const project = (m: ReturnType<typeof makeMarkers>[number]): [number, number] => [m.x, m.z];
  const shared = () =>
    makeMarkers(
      [
        gen(1, 4, [
          [345, -25],
          [365, -35],
          [335, -55],
          [405, -85],
        ]),
        gen(2, 4, [
          [405, -85],
          [425, -105],
          [435, -85],
          [395, -115],
        ]),
      ],
      new Map([
        [1, { ...enemy(1), name: 'Numemon' }],
        [2, { ...enemy(2), name: 'Kokatorimon' }],
      ]),
    );

  it('exposes both Goblin Pass groups at the shared position without shifting their spawns', () => {
    const markers = shared();
    const hit = pickMarker(markers, project, 405, -85, null, 12)!;
    expect(hit.label).toBe('Kokatorimon');
    expect(markersAtSpot(markers, hit).map((m) => m.label)).toEqual(['Numemon', 'Kokatorimon']);
    expect(markersAtSpot(markers, markers[0])).toEqual([markers[0]]);
    expect(hit.x).toBe(405);
    expect(hit.z).toBe(-85);
  });

  it('cycles every overlapping group and keeps hover aligned with the selected marker', () => {
    const markers = shared();
    let hit = pickMarker(markers, project, 405, -85, null, 12)!;
    expect(nextMarkerAtSpot(markers, hit, null).gi).toBe(hit.gi);
    const visited: string[] = [];
    for (let i = 0; i < 3; i++) {
      visited.push(hit.label);
      expect(pickMarker(markers, project, 405, -85, hit.gi, 12)).toBe(hit);
      hit = nextMarkerAtSpot(markers, hit, hit.gi);
    }
    expect(visited).toEqual(['Kokatorimon', 'Numemon', 'Kokatorimon']);
  });

  it('does not mix nearby markers into a shared point or repeat one group with duplicate spots', () => {
    const markers = makeMarkers(
      [
        gen(1, 3, [
          [0, 0],
          [0, 0],
          [2, 0],
        ]),
        gen(2, 1, [[0, 0]]),
      ],
      enemies,
    );
    expect(markersAtSpot(markers, markers[0]).map((m) => m.gi)).toEqual([0, 1]);
    expect(markersAtSpot(markers, markers[2])).toEqual([markers[2]]);
    expect(pickMarker(markers, project, 2, 0, null, 12)).toBe(markers[2]);
    expect(pickMarker(markers, project, 50, 50, null, 12)).toBeNull();
  });
});

describe('start text and triggers', () => {
  const radar: Generator = {
    ...gen(1, 2, [
      [0, 0],
      [20, 0],
      [0, 20],
    ]),
    startMode: 'radar',
    trigger: { center: [5, 50, 5], radius: 65 },
  };

  it('says how close you must get for a radar spawner', () => {
    expect(startSummary(radar, enemy(1))).toBe('Appears when you get within 65 units');
    expect(startSummary(gen(1, 1, [[0, 0]]), enemy(1))).toBe('Started by a game script');
  });

  it('puts the trigger on the markers and the start text in the tooltip', () => {
    const [m] = makeMarkers([radar], enemies);
    expect(m.trigger).toEqual({ x: 5, z: 5, radius: 65 });
    expect(m.detail).toMatch(/within 65 units/);
    expect(makeMarkers([gen(9, 1, [[0, 0]])], enemies)[0].trigger).toBeNull();
  });

  it('does not describe how an object starts', () => {
    expect(makeMarkers([gen(9, 1, [[0, 0]])], enemies)[0].detail).not.toMatch(/script/);
  });
});

describe('unused spawners', () => {
  const unusedGen: Generator = { ...gen(1, 1, [[0, 0]]), script: { status: 'none' } };

  it('are dropped when hidden and flagged when shown', () => {
    expect(makeMarkers([unusedGen], enemies, true)).toHaveLength(0);
    const [m] = makeMarkers([unusedGen], enemies, false);
    expect(m.unused).toBe(true);
    expect(m.detail).toMatch(/No script starts it/);
  });

  it('never hide radar spawners, scripted ones or objects', () => {
    const radar: Generator = { ...unusedGen, startMode: 'radar' };
    const started: Generator = {
      ...unusedGen,
      script: { status: 'referenced', refs: [{ verb: 'START', when: ['event 3 done'] }] },
    };
    const obj: Generator = { ...gen(9, 1, [[0, 0]]), script: { status: 'none' } };
    expect(makeMarkers([radar, started, obj], enemies, true)).toHaveLength(3);
  });

  it('summarise what starts a scripted spawner', () => {
    const g: Generator = {
      ...gen(1, 1, [[0, 0]]),
      script: {
        status: 'referenced',
        refs: [
          { verb: 'RESTART', when: ['a player touches the trigger and event 339 not done yet'] },
        ],
      },
    };
    expect(startSummary(g, enemy(1))).toBe(
      'Started by a script when a player touches the trigger and event 339 not done yet',
    );
    expect(startSummary({ ...g, script: { status: 'dynamic' } }, enemy(1))).toMatch(
      /builds spawner names/,
    );
  });
});

describe('makeMarkers', () => {
  it('draws one marker per spot when each spot holds one enemy', () => {
    const m = makeMarkers(
      [
        gen(1, 2, [
          [0, 0],
          [10, 0],
        ]),
      ],
      enemies,
    );
    expect(m.map((x) => [x.x, x.badge, x.others])).toEqual([
      [0, 1, null],
      [10, 1, null],
    ]);
  });

  it('uses only the first spots when a spawner has more spots than enemies', () => {
    const m = makeMarkers(
      [
        gen(1, 2, [
          [0, 0],
          [20, 0],
          [0, 20],
          [20, 20],
        ]),
      ],
      enemies,
    );
    expect(m.map((x) => [x.x, x.z])).toEqual([
      [0, 0],
      [20, 0],
    ]);
    expect(m[0].others).toEqual([
      [0, 20],
      [20, 20],
    ]);
    expect(m.every((x) => x.badge === 1)).toBe(true);
    expect(m[0].detail).toMatch(/first 2 of 4 spots/);
  });

  it('shares a wave total across the spots of a spawner that respawns', () => {
    expect(makeMarkers([gen(1, 14, [[0, 0]])], enemies).map((x) => x.badge)).toEqual([14]);
    expect(
      makeMarkers(
        [
          gen(1, 12, [
            [0, 0],
            [5, 0],
            [9, 0],
          ]),
        ],
        enemies,
      ).map((x) => x.badge),
    ).toEqual([4, 4, 4]);
  });

  it('keeps every placed object as its own marker', () => {
    const m = makeMarkers(
      [
        gen(9, 9, [
          [0, 0],
          [1, 0],
          [2, 0],
        ]),
      ],
      enemies,
    );
    expect(m).toHaveLength(3);
    expect(m.every((x) => x.badge === 1 && x.kind === 'object' && x.others === null)).toBe(true);
  });

  it('falls back to one marker per spot when the count is unknown', () => {
    expect(
      makeMarkers(
        [
          gen(1, null, [
            [0, 0],
            [1, 1],
          ]),
        ],
        enemies,
      ),
    ).toHaveLength(2);
  });

  it('never uses fewer than the spawner has when objects have a short list', () => {
    expect(
      makeMarkers(
        [
          gen(9, 1, [
            [0, 0],
            [1, 0],
          ]),
        ],
        enemies,
      ),
    ).toHaveLength(2);
  });
});
