import { describe, expect, it } from 'vitest';
import { Model } from './model';
import { featuredEnemies, matchRank, normalize, search } from './search';
import { DEFAULT_SCOPE } from './model';
import type { RawData, Stage } from './types';

const stage = (id: string, area: string, room: string): Stage => ({
  id,
  area,
  room,
  kind: 'field',
  floor: null,
  variant: null,
  banner: null,
  map: null,
  trades: [],
  difficulties: {
    hard: {
      generators: [
        {
          name: 'G',
          row: 1,
          count: 1,
          maxCount: 1,
          spawns: [[0, 0, 0]],
          rotations: [],
          startMode: 'radar',
          fillMode: 'wipeout',
        },
      ],
    },
  },
});

function model(): Model {
  const enemy = (row: number, name: string, kind: 'enemy' | 'boss' | 'object' = 'enemy') => ({
    row,
    name,
    kind,
    model: 'm',
    hp: 1,
    stats: { strength: 1, defense: 1, wisdom: 1, spirit: 1, speed: 1, exp: 1 },
    resist: { fire: 0, ice: 0, thunder: 0, dark: 0, stun: 0, poison: 0 },
    rates: { crit: 0, paralysis: 0 },
    rarity: 0,
  });
  const raw: RawData = {
    manifest: {
      schemaVersion: 1,
      platform: 'ps2',
      region: 'usa',
      serial: null,
      counts: {},
      knownGaps: [],
    },
    enemies: {
      rows: [
        enemy(1, 'Goburimon'),
        enemy(2, 'Goburimon'),
        enemy(3, 'Ogremon', 'boss'),
        enemy(4, 'Barrel', 'object'),
      ],
    },
    items: {
      items: [
        { category: 'weapon', id: 0, name: 'Long Sword α', description: null },
        { category: 'weapon', id: 1, name: 'Sword', description: null },
        { category: 'weapon', id: 2, name: 'War Sword β', description: null },
        { category: 'conItem', id: 0, name: 'HP Disk α', description: null },
      ],
    },
    drops: { pools: {} },
    stages: {
      stages: [
        stage('stag0102', 'Death Valley', 'Abyss of Grief'),
        stage('stag0000', 'Death Valley', 'Debug Stage'),
      ],
    },
  };
  return new Model(raw);
}

describe('search', () => {
  it('spells Greek tier letters in Latin', () => {
    expect(normalize('Long Sword α')).toBe('long sword a');
    expect(normalize('  HP-Disk  β ')).toBe('hp disk b');
  });

  it('ranks exact, prefix, word start, anywhere, then scattered words', () => {
    expect(matchRank('sword', 'sword')).toBe(0);
    expect(matchRank('sword breaker', 'sword')).toBe(1);
    expect(matchRank('long sword a', 'sword')).toBe(2);
    expect(matchRank('broadsword', 'sword')).toBe(3);
    expect(matchRank('long sword a', 'sword long')).toBe(4);
    expect(matchRank('long sword a', 'axe')).toBeNull();
  });

  it('orders items by how well they match', () => {
    expect(search(model(), 'sword').items.map((h) => h.label)).toEqual([
      'Sword',
      'War Sword β',
      'Long Sword α',
    ]);
    expect(search(model(), 'long sword a').items.map((h) => h.id)).toEqual(['weapon:0']);
  });

  it('lists enemies once per name and leaves out objects', () => {
    const { enemies } = search(model(), 'mon');
    expect(enemies.map((h) => h.label)).toEqual(['Ogremon', 'Goburimon']);
    expect(enemies.find((h) => h.label === 'Goburimon')?.detail).toBe('Enemy · 2 stat variants');
    expect(search(model(), 'barrel').enemies).toEqual([]);
  });

  it('finds rooms by name or world, never the developer stages', () => {
    expect(search(model(), 'abyss').rooms.map((h) => h.id)).toEqual(['stag0102']);
    expect(search(model(), 'death valley').rooms.map((h) => h.label)).toEqual(['Abyss of Grief']);
    expect(search(model(), 'debug').rooms).toEqual([]);
  });

  it('lists a whole category when filtered', () => {
    const r = search(model(), '', 'weapon');
    expect(r.items.map((h) => h.label)).toEqual(['Long Sword α', 'Sword', 'War Sword β']);
    expect(r.enemies).toEqual([]);
    expect(search(model(), 'war', 'weapon').items.map((h) => h.label)).toEqual(['War Sword β']);
  });
});

describe('featuredEnemies', () => {
  it('lists bosses first, then enemies, only those that spawn somewhere', () => {
    const m = model();
    // Ogremon (a boss) spawns nowhere in the fixture and the barrel is an object.
    expect(featuredEnemies(m, 4, DEFAULT_SCOPE)).toEqual([
      { name: 'Goburimon', kind: 'enemy', area: 'Death Valley' },
    ]);
    const boss = m.raw.stages.stages[0].difficulties.hard!.generators;
    boss.push({ ...boss[0], name: 'B', row: 3 });
    const fresh = new Model(m.raw);
    expect(featuredEnemies(fresh, 1, DEFAULT_SCOPE).map((e) => [e.name, e.kind])).toEqual([
      ['Ogremon', 'boss'],
      ['Goburimon', 'enemy'],
    ]);
    expect(featuredEnemies(fresh, 0, DEFAULT_SCOPE)).toEqual([]);
  });
});
