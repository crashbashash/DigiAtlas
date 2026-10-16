import { describe, expect, it } from 'vitest';
import { Model } from './model';
import type { DropPool, Enemy, Generator, RawData, Stage } from './types';

const enemy = (row: number, name: string, kind: Enemy['kind'] = 'enemy'): Enemy => ({
  row, name, kind, model: 'm', hp: 10 * row,
  stats: { strength: 1, defense: 1, wisdom: 1, spirit: 1, speed: 1, exp: 1 },
  resist: { fire: 0, ice: 0, thunder: 0, dark: 0, stun: 0, poison: 0 },
  rates: { crit: 0, paralysis: 0 }, rarity: 0,
});

const gen = (name: string, row: number, drops: Record<string, string> | undefined): Generator => ({
  name, row, count: 2, maxCount: 1, spawns: [[0, 0, 0]], rotations: [], startMode: 'direct', fillMode: 'wipeout', drops,
});

const stage = (id: string, area: string, room: string, kind: Stage['kind'], gens: Generator[] | null): Stage => ({
  id, area, room, kind, floor: null, variant: null, banner: null, map: null,
  difficulties: gens ? { normal: { generators: gens }, hard: { generators: gens } } : {},
});

const pool = (...entries: [string, number, number][]): DropPool => ({
  entries: entries.map(([category, id, rate]) => ({ category, id, rank: 0, rate })),
  totalRate: entries.reduce((n, e) => n + e[2], 0),
});

function model(): Model {
  const raw: RawData = {
    manifest: { schemaVersion: 1, platform: 'ps2', region: 'usa', serial: null, counts: {}, knownGaps: [] },
    enemies: { rows: [enemy(1, 'Goburimon'), enemy(2, 'Ogremon'), enemy(9, 'Box', 'object')] },
    items: { items: [
      { category: 'weapon', id: 0, name: 'Battle Hawk α', description: null },
      { category: 'conItem', id: 0, name: 'HP Disk α', description: null },
    ] },
    drops: { pools: { nA: pool(['weapon', 0, 300], ['conItem', 0, 1000]), nB: pool(['weapon', 0, 100]) } },
    stages: { stages: [
      stage('dng101b1', 'Death Valley', 'Humid Cave', 'dungeon', [gen('G1', 1, { normal: 'nA', hard: 'nB' })]),
      stage('stag0102', 'Death Valley', 'Abyss of Grief', 'field', [
        gen('G1', 1, { normal: 'nA', hard: 'nB' }), gen('G2', 1, { normal: 'nA', hard: 'nB' }), gen('G3', 2, { normal: 'nB' }), gen('B1', 9, undefined),
      ]),
      stage('stagML12', 'Home Server', 'Main Lobby', 'hub', null),
    ] },
  };
  return new Model(raw);
}

describe('unused spawners', () => {
  const withUnused = (): Model => {
    const raw = model().raw;
    raw.stages.stages[1].difficulties.hard!.generators[1].script = { status: 'none' };
    return new Model(raw);
  };

  it('are hidden by default and counted either way', () => {
    const m = withUnused();
    const stage = m.byId.get('stag0102')!;
    expect([...m.hidden(stage, 'hard')]).toEqual([1]);
    expect(m.unusedCount(stage, 'hard')).toBe(1);
    m.hideUnused = false;
    expect(m.hidden(stage, 'hard').size).toBe(0);
    expect(m.unusedCount(stage, 'hard')).toBe(1);
  });

  it('do not count as item sources unless shown', () => {
    const m = withUnused();
    const stageOf = (list: ReturnType<Model['sourcesOf']>) => list.filter((s) => s.stage.id === 'stag0102' && s.enemyName === 'Goburimon');
    expect(stageOf(m.sourcesOf('weapon:0', 'hard'))[0].generators).toEqual([0]);
    m.hideUnused = false;
    expect(stageOf(m.sourcesOf('weapon:0', 'hard'))[0].generators).toEqual([0, 1]);
  });
});

describe('player counts', () => {
  const scaled = (): Model => {
    const raw = model().raw;
    const g = raw.stages.stages[1].difficulties.hard!.generators[0];
    g.players = [
      { count: 2, maxCount: 2, drops: { hard: 'nB' } },
      { count: 3, maxCount: 3, drops: { hard: 'nA' } },
      { count: 4, maxCount: 4, drops: { hard: 'nA' } },
      { count: 5, maxCount: 5, drops: { hard: 'nA' } },
    ];
    return new Model(raw);
  };

  it('uses the one-player numbers by default and the chosen entry otherwise', () => {
    const m = scaled();
    const stage = m.byId.get('stag0102')!;
    expect(m.generators(stage, 'hard')[0].count).toBe(2);
    m.players = 3;
    const g = m.generators(stage, 'hard')[0];
    expect([g.count, g.maxCount, g.drops?.hard]).toEqual([4, 4, 'nA']);
    expect(m.poolFor(g, 'hard')?.totalRate).toBe(1300);
  });

  it('leaves spawners without per-player data unchanged', () => {
    const m = scaled();
    m.players = 4;
    expect(m.generators(m.byId.get('dng101b1')!, 'hard')[0].count).toBe(2);
  });

  it('keeps item sources separate per player count', () => {
    const m = scaled();
    const before = m.sourcesOf('conItem:0', 'hard').length;
    m.players = 2;
    expect(m.sourcesOf('conItem:0', 'hard').length).toBeGreaterThan(before);
    m.players = 1;
    expect(m.sourcesOf('conItem:0', 'hard').length).toBe(before);
  });

  it('clamps the number of players', () => {
    const m = model();
    m.players = 9;
    expect(m.players).toBe(4);
    m.players = 0;
    expect(m.players).toBe(1);
  });
});

describe('Model', () => {
  it('lists only stages that spawn something, fields before dungeons', () => {
    const m = model();
    expect(m.stages.map((s) => s.id).sort()).toEqual(['dng101b1', 'stag0102']);
    expect(m.worlds).toHaveLength(1);
    expect(m.worlds[0].rooms.map((r) => r.room)).toEqual(['Abyss of Grief', 'Humid Cave']);
  });

  it('looks up the drop pool for the chosen difficulty', () => {
    const m = model();
    const g = m.generators(m.byId.get('stag0102')!, 'hard')[0];
    expect(m.poolFor(g, 'hard')?.totalRate).toBe(100);
    expect(m.poolFor(g, 'normal')?.totalRate).toBe(1300);
    expect(m.poolFor(m.generators(m.byId.get('stag0102')!, 'hard')[3], 'hard')).toBeNull();
  });

  it('reports which difficulties a stage has data for', () => {
    expect(model().available(model().byId.get('stag0102')!)).toEqual(['normal', 'hard']);
  });

  it('collapses spawners that share a table into one source row per stage and enemy', () => {
    const m = model();
    const sources = m.sourcesOf('weapon:0', 'hard');
    const here = sources.filter((s) => s.stage.id === 'stag0102' && s.enemyName === 'Goburimon');
    expect(here).toHaveLength(1);
    expect(here[0].generators).toEqual([0, 1]);
    expect(here[0].percent).toBe(1);
    expect(here[0].enemyName).toBe('Goburimon');
  });

  it('merges stat rows of one enemy that share a chance', () => {
    const raw = model().raw;
    raw.enemies.rows.push(enemy(3, 'Goburimon'));
    raw.stages.stages[1].difficulties.hard!.generators.push(gen('G5', 3, { hard: 'nB' }));
    const sources = new Model(raw).sourcesOf('weapon:0', 'hard').filter((s) => s.stage.id === 'stag0102' && s.enemyName === 'Goburimon');
    expect(sources).toHaveLength(1);
    expect(sources[0].variants).toBe(2);
    expect(sources[0].generators).toEqual([0, 1, 4]);
  });

  it('numbers items that share a name', () => {
    const raw = model().raw;
    raw.items.items.push({ category: 'insItem', id: 1, name: 'X-Data', description: null }, { category: 'insItem', id: 2, name: 'X-Data', description: null });
    const m = new Model(raw);
    expect(m.itemLabel('insItem:1')).toBe('X-Data (1 of 2)');
    expect(m.itemLabel('insItem:2')).toBe('X-Data (2 of 2)');
    expect(m.itemLabel('weapon:0')).toBe('Battle Hawk α');
  });

  it('orders sources by best chance and keeps difficulties apart', () => {
    const m = model();
    expect(m.sourcesOf('weapon:0', 'normal').map((s) => s.percent)).toEqual([3, 3, 1]);
    expect(m.sourcesOf('conItem:0', 'hard')).toEqual([]);
    expect(m.sourcesOf('conItem:0', 'normal')).toHaveLength(2);
  });

  it('titles stages with floor and variant', () => {
    const m = model();
    expect(m.stageTitle({ ...m.byId.get('dng101b1')!, floor: 'B2', variant: 'h' })).toBe('Humid Cave B2 (h)');
  });
});
