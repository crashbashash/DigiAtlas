import { describe, expect, it } from 'vitest';
import { clampPlayers, Model } from './model';
import type { DropPool, Enemy, Generator, RawData, Stage } from './types';

const enemy = (row: number, name: string, kind: Enemy['kind'] = 'enemy'): Enemy => ({
  row,
  name,
  kind,
  model: 'm',
  hp: 10 * row,
  stats: { strength: 1, defense: 1, wisdom: 1, spirit: 1, speed: 1, exp: 1 },
  resist: { fire: 0, ice: 0, thunder: 0, dark: 0, stun: 0, poison: 0 },
  rates: { crit: 0, paralysis: 0 },
  rarity: 0,
});

const gen = (name: string, row: number, drops: Record<string, string> | undefined): Generator => ({
  name,
  row,
  count: 2,
  maxCount: 1,
  spawns: [[0, 0, 0]],
  rotations: [],
  startMode: 'direct',
  fillMode: 'wipeout',
  drops,
});

const stage = (
  id: string,
  area: string,
  room: string,
  kind: Stage['kind'],
  gens: Generator[] | null,
): Stage => ({
  id,
  area,
  room,
  kind,
  floor: null,
  variant: null,
  banner: null,
  map: null,
  trades: [],
  difficulties: gens ? { normal: { generators: gens }, hard: { generators: gens } } : {},
});

const pool = (...entries: [string, number, number][]): DropPool => ({
  entries: entries.map(([category, id, rate]) => ({ category, id, rank: 0, rate })),
  totalRate: entries.reduce((n, e) => n + e[2], 0),
});

function model(): Model {
  const raw: RawData = {
    manifest: {
      schemaVersion: 1,
      platform: 'ps2',
      region: 'usa',
      serial: null,
      counts: {},
      knownGaps: [],
    },
    enemies: { rows: [enemy(1, 'Goburimon'), enemy(2, 'Ogremon'), enemy(9, 'Box', 'object')] },
    items: {
      items: [
        { category: 'weapon', id: 0, name: 'Battle Hawk α', description: null },
        { category: 'conItem', id: 0, name: 'HP Disk α', description: null },
      ],
    },
    drops: {
      pools: { nA: pool(['weapon', 0, 300], ['conItem', 0, 1000]), nB: pool(['weapon', 0, 100]) },
    },
    stages: {
      stages: [
        stage('dng101b1', 'Death Valley', 'Humid Cave', 'dungeon', [
          gen('G1', 1, { normal: 'nA', hard: 'nB' }),
        ]),
        stage('stag0102', 'Death Valley', 'Abyss of Grief', 'field', [
          gen('G1', 1, { normal: 'nA', hard: 'nB' }),
          gen('G2', 1, { normal: 'nA', hard: 'nB' }),
          gen('G3', 2, { normal: 'nB' }),
          gen('B1', 9, undefined),
        ]),
        stage('stagML12', 'Home Server', 'Main Lobby', 'hub', null),
      ],
    },
  };
  return new Model(raw);
}

const at = { position: { x: 0, y: 0, z: 0 }, facing: 0 };
const swap = (give: [string, number], get: [string, number]) => ({
  give: { category: give[0], id: give[1] },
  get: { category: get[0], id: get[1] },
});

describe('tradesFor', () => {
  it('finds the traders who hand over an item and what they want for it', () => {
    const m = model();
    const hall = m.byId.get('stag0102')!;
    hall.trades = [
      {
        trader: 'Agumon',
        number: 1,
        ...at,
        tables: { hard: [swap(['conItem', 0], ['weapon', 0])] },
      },
      {
        trader: 'Agumon',
        number: 2,
        ...at,
        tables: { hard: [swap(['weapon', 0], ['conItem', 0])] },
      },
    ];
    const got = m.tradesFor('weapon:0');
    expect(got.getFrom.map((t) => [t.stage.id, t.label, t.other])).toEqual([
      ['stag0102', 'Agumon 1', 'HP Disk α'],
    ]);
    expect(got.giveTo.map((t) => [t.label, t.other])).toEqual([['Agumon 2', 'HP Disk α']]);
  });

  it('records which difficulties a trade is on', () => {
    const m = model();
    m.byId.get('stag0102')!.trades = [
      {
        trader: 'Agumon',
        number: null,
        ...at,
        tables: {
          normal: [swap(['conItem', 0], ['weapon', 0])],
          veryhard: [swap(['conItem', 0], ['weapon', 0])],
          hard: [swap(['conItem', 0], ['weapon', 1])],
        },
      },
    ];
    expect(m.tradesFor('weapon:0').getFrom.map((t) => t.difficulties)).toEqual([
      ['normal', 'veryhard'],
    ]);
  });

  it('lists a trade once when a room has several variants with the same traders', () => {
    const m = model();
    const a = m.byId.get('stag0102')!;
    const b = m.byId.get('dng101b1')!;
    const traders = [
      {
        trader: 'Agumon',
        number: null,
        ...at,
        tables: { hard: [swap(['conItem', 0], ['weapon', 0])] },
      },
    ];
    a.trades = traders;
    b.trades = traders;
    a.room = b.room = 'Trader Hall';
    a.floor = b.floor = 'B1';
    expect(m.tradesFor('weapon:0').getFrom).toHaveLength(1);
  });
});

describe('traders by difficulty', () => {
  it('offers the difficulty selector in a shop and lists only the traders with a table there', () => {
    const m = model();
    const hall = m.byId.get('dng101b1')!;
    hall.difficulties = {};
    hall.trades = [
      {
        trader: 'Agumon',
        number: 1,
        ...at,
        tables: {
          normal: [swap(['conItem', 0], ['weapon', 0])],
          hard: [swap(['conItem', 0], ['weapon', 1])],
        },
      },
      {
        trader: 'BK WarGreymon',
        number: null,
        ...at,
        tables: { veryhard: [swap(['conItem', 0], ['weapon', 2])] },
      },
    ];
    expect(m.available(hall)).toEqual(['normal', 'hard', 'veryhard']);
    expect(m.tradersAt(hall, 'hard').map((t) => t.trader)).toEqual(['Agumon']);
    expect(m.tradersAt(hall, 'veryhard').map((t) => t.trader)).toEqual(['BK WarGreymon']);
    expect(m.hasSpawns(hall)).toBe(false);
  });
});

describe('entryDifficulty', () => {
  it('is the difficulty a shop copy is entered on, and none for rooms with spawners', () => {
    const m = model();
    const hall = m.byId.get('dng101b1')!;
    expect(m.entryDifficulty({ ...hall, variant: 'v', difficulties: {} })).toBe('veryhard');
    expect(m.entryDifficulty({ ...hall, variant: 'v' })).toBeNull();
    expect(m.entryDifficulty({ ...hall, variant: null, difficulties: {} })).toBeNull();
  });
});

describe('appraisal', () => {
  const withAppraiser = (): Model => {
    const raw = model().raw;
    raw.items.items.push(
      {
        category: 'weapon',
        id: 276,
        name: 'Unidentified Weapon',
        description: null,
        unidentified: true,
      },
      { category: 'weapon', id: 25, name: 'Battle Hawk β', description: null },
    );
    const tier = (n: number, min: number, max: number | null, results: [number, number][]) => ({
      tier: n,
      minLevel: min,
      maxLevel: max,
      results: {
        weapon: results.map(([id, rate]) => ({ category: 'weapon' as const, id, rate })),
        armor1: [],
        armor2: [],
      },
    });
    raw.items.appraisal = {
      cost: 300,
      tiers: [
        tier(1, 0, 40, [
          [0, 6000],
          [25, 4000],
        ]),
        tier(2, 41, null, [
          [0, 2500],
          [25, 7500],
        ]),
      ],
    };
    return new Model(raw);
  };

  it('lists what an unidentified item can become, per tier, best first', () => {
    const t = withAppraiser().appraisalTable('weapon:276')!;
    expect(t.cost).toBe(300);
    expect(t.columns).toEqual(['Lv 1–40', 'Lv 41+']);
    expect(t.rows.map((r) => [r.label, r.percents])).toEqual([
      ['Battle Hawk β', [40, 75]],
      ['Battle Hawk α', [60, 25]],
    ]);
  });

  it('joins neighbouring tiers that give the same results', () => {
    const m = withAppraiser();
    const a = m.raw.items.appraisal!;
    a.tiers.push({ ...a.tiers[1], tier: 3, minLevel: 101, maxLevel: null });
    a.tiers[1] = { ...a.tiers[1], maxLevel: 100 };
    expect(m.appraisalTable('weapon:276')!.columns).toEqual(['Lv 1–40', 'Lv 41+']);
    expect(m.appraisedFrom('weapon:25')!.ranges).toEqual([
      { label: 'Lv 1–40', percent: 40 },
      { label: 'Lv 41+', percent: 75 },
    ]);
  });

  it('says which tiers can produce an ordinary item', () => {
    const from = withAppraiser().appraisedFrom('weapon:25')!;
    expect(from.from).toBe('Unidentified Weapon');
    expect(from.ranges.map((r) => [r.label, r.percent])).toEqual([
      ['Lv 1–40', 40],
      ['Lv 41+', 75],
    ]);
  });

  it('has nothing for items the appraiser cannot make or data without it', () => {
    const m = withAppraiser();
    expect(m.appraisedFrom('conItem:0')).toBeNull();
    expect(m.appraisalTable('weapon:0')).toBeNull();
    expect(model().appraisedFrom('weapon:0')).toBeNull();
  });
});

describe('mapsFor', () => {
  it('lists each map once with its best chance and how many spawners drop the item', () => {
    const m = model();
    const maps = m.mapsFor('weapon:0', 'normal');
    expect(maps.map((x) => x.stage.id)).toEqual(['dng101b1', 'stag0102']);
    const abyss = maps.find((x) => x.stage.id === 'stag0102')!;
    expect(abyss.percent).toBe(3);
    expect(abyss.spawners).toBe(3);
    expect(abyss.droppedBy).toEqual(['Goburimon', 'Ogremon']);
  });

  it('is empty for an item nothing drops', () => {
    expect(model().mapsFor('weapon:99', 'normal')).toEqual([]);
  });
});

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
    expect(m.hidden(stage, 'hard', { players: 1, hideUnused: false }).size).toBe(0);
    expect(m.unusedCount(stage, 'hard')).toBe(1);
  });

  it('do not count as item sources unless shown', () => {
    const m = withUnused();
    const stageOf = (list: ReturnType<Model['sourcesOf']>) =>
      list.filter((s) => s.stage.id === 'stag0102' && s.enemyName === 'Goburimon');
    expect(stageOf(m.sourcesOf('weapon:0', 'hard'))[0].generators).toEqual([0]);
    expect(
      stageOf(m.sourcesOf('weapon:0', 'hard', { players: 1, hideUnused: false }))[0].generators,
    ).toEqual([0, 1]);
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
    const g = m.generators(stage, 'hard', { players: 3, hideUnused: true })[0];
    expect([g.count, g.maxCount, g.drops?.hard]).toEqual([4, 4, 'nA']);
    expect(m.poolFor(g, 'hard')?.totalRate).toBe(1300);
  });

  it('leaves spawners without per-player data unchanged', () => {
    const m = scaled();
    expect(
      m.generators(m.byId.get('dng101b1')!, 'hard', { players: 4, hideUnused: true })[0].count,
    ).toBe(2);
  });

  it('keeps item sources separate per player count', () => {
    const m = scaled();
    const before = m.sourcesOf('conItem:0', 'hard').length;
    const two = { players: 2, hideUnused: true };
    expect(m.sourcesOf('conItem:0', 'hard', two).length).toBeGreaterThan(before);
    expect(m.sourcesOf('conItem:0', 'hard').length).toBe(before);
  });

  it('clamps the number of players', () => {
    expect(clampPlayers(9)).toBe(4);
    expect(clampPlayers(0)).toBe(1);
    expect(clampPlayers(Number.NaN)).toBe(1);
    const m = scaled();
    const g = m.generators(m.byId.get('stag0102')!, 'hard', { players: 9, hideUnused: true })[0];
    expect(g.count).toBe(5);
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
    const sources = new Model(raw)
      .sourcesOf('weapon:0', 'hard')
      .filter((s) => s.stage.id === 'stag0102' && s.enemyName === 'Goburimon');
    expect(sources).toHaveLength(1);
    expect(sources[0].variants).toBe(2);
    expect(sources[0].generators).toEqual([0, 1, 4]);
  });

  it('renders elemental chip icons as readable names and descriptions without changing imported data', () => {
    const raw = model().raw;
    for (const [id, glyph] of ['⊂', '⊃', '∪', '∩'].entries()) {
      raw.items.items.push(
        { category: 'abChip', id, name: `${glyph}PWR Medal α+30`, description: null },
        {
          category: 'abChip',
          id: id + 4,
          name: `${glyph}Resist ROM β`,
          description: `${glyph}resistance up 120 pts.\nEquip with AB only`,
        },
      );
    }
    const m = new Model(raw);
    for (const [id, element] of ['Fire', 'Ice', 'Thunder', 'Dark'].entries()) {
      expect(m.itemLabel(`abChip:${id}`)).toBe(`${element} PWR Medal α+30`);
      expect(m.itemLabel(`abChip:${id + 4}`)).toBe(`${element} Resist ROM β`);
      expect(m.items.get(`abChip:${id + 4}`)?.description).toBe(
        `${element} resistance up 120 pts.\nEquip with AB only`,
      );
    }
    expect(raw.items.items.find((i) => i.category === 'abChip' && i.id === 0)?.name).toBe(
      '⊂PWR Medal α+30',
    );
  });

  it('marks unresolved duplicate names as variants rather than collection counts', () => {
    const raw = model().raw;
    raw.items.items.push(
      { category: 'insItem', id: 1, name: 'X-Data', description: null },
      { category: 'insItem', id: 2, name: 'X-Data', description: null },
    );
    const m = new Model(raw);
    expect(m.itemLabel('insItem:1')).toBe('X-Data (variant 1)');
    expect(m.itemLabel('insItem:2')).toBe('X-Data (variant 2)');
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
    expect(m.stageTitle({ ...m.byId.get('dng101b1')!, floor: 'B2', variant: 'h' })).toBe(
      'Humid Cave B2 (Hard)',
    );
  });
});

describe('species', () => {
  it('keeps spawn locations and counts specific to the selected variant', () => {
    const m = model();
    m.enemies.set(3, enemy(3, 'Goburimon'));
    const variant = { ...gen('Crown', 3, undefined), count: 9 };
    m.byId.get('stag0102')!.difficulties.hard!.generators.push(variant);
    expect(m.rowSpawns(3, 'hard').map((s) => [s.stage.id, s.total, s.rows])).toEqual([
      ['stag0102', 9, [3]],
    ]);
    expect(m.rowSpawns(1, 'hard').map((s) => [s.stage.id, s.total])).toEqual([
      ['stag0102', 4],
      ['dng101b1', 2],
    ]);
    expect(m.rowSpawns(3, 'veryhard')).toEqual([]);
    variant.script = { status: 'none' };
    expect(m.rowSpawns(3, 'hard')).toEqual([]);
    expect(m.rowSpawns(3, 'hard', { players: 1, hideUnused: false })[0].total).toBe(9);
  });

  it('lists the rooms an enemy spawns in, most placed first', () => {
    const spawns = model().spawnsOf('Goburimon', 'hard');
    expect(spawns.map((s) => [s.stage.id, s.spawners, s.total])).toEqual([
      ['stag0102', 2, 4],
      ['dng101b1', 1, 2],
    ]);
    expect(spawns[0].rows).toEqual([1]);
    expect(model().spawnsOf('Nobody', 'hard')).toEqual([]);
  });

  it('gives the stat rows used on a difficulty, or all of them when it spawns nowhere', () => {
    const m = model();
    expect(m.variantsOn('Goburimon', 'hard').map((e) => e.row)).toEqual([1]);
    m.raw.stages.stages[0].difficulties = {};
    m.raw.stages.stages[1].difficulties = {};
    expect(m.variantsOn('Goburimon', 'hard').map((e) => e.row)).toEqual([1]);
    expect(m.spawnsOf('Goburimon', 'hard')).toEqual([]);
  });

  it('merges what an enemy drops across rooms, best chance first', () => {
    const drops = model().dropsOf('Goburimon', 'normal');
    expect(drops.map((x) => [x.key, x.percent])).toEqual([
      ['conItem:0', 10],
      ['weapon:0', 3],
    ]);
    expect(drops[0].stages.map((x) => x.stage.id).sort()).toEqual(['dng101b1', 'stag0102']);
    expect(model().dropsOf('Ogremon', 'hard')).toEqual([]);
  });
});

describe('boss parts', () => {
  const withBoss = () => {
    const m = model();
    const boss = { ...enemy(20, 'Lucemon', 'boss') };
    const orb = { ...enemy(21, "Lucemon's orb", 'boss'), role: 'part' as const, partOf: 'Lucemon' };
    m.enemies.set(20, boss);
    m.enemies.set(21, orb);
    const room = stage('stagBS03', 'Venom Jungle', 'Hades Obelisk', 'boss', [
      gen('B', 20, undefined),
      gen('O1', 21, undefined),
      gen('O2', 21, undefined),
      gen('O3', 21, undefined),
    ]);
    for (const g of room.difficulties.hard!.generators) g.count = 1;
    m.stages.push(room);
    m.byId.set(room.id, room);
    return m;
  };

  it('knows which names are only parts', () => {
    const m = withBoss();
    expect(m.isPartOnly("Lucemon's orb")).toBe(true);
    expect(m.isPartOnly('Lucemon')).toBe(false);
    expect(m.isPartOnly('Nobody')).toBe(false);
  });

  it("counts a boss's parts in the rooms it fights in", () => {
    const parts = withBoss().partsOf('Lucemon', 'hard');
    expect(parts.map((p) => [p.name, p.count, p.rows.map((r) => r.row)])).toEqual([
      ["Lucemon's orb", 3, [21]],
    ]);
    expect(withBoss().partsOf('Goburimon', 'hard')).toEqual([]);
  });
});

describe('boss fights', () => {
  it('counts a kill that always gives a key item as a boss fight', () => {
    const m = model();
    m.raw.drops.pools.nID = pool(['impItem', 0, 10000]);
    m.raw.drops.pools.nKey = pool(['impItem', 1, 500]);
    const boss = { ...gen('G9', 2, undefined), lastDrops: { normal: 'nID' } };
    const lucky = gen('G8', 1, { normal: 'nKey' });
    const crate = { ...gen('B2', 9, undefined), lastDrops: { normal: 'nID' } };
    m.raw.stages.stages[0].difficulties.normal!.generators.push(boss, lucky, crate);
    expect(m.isBossFight(boss)).toBe(true);
    expect(m.isBossFight(lucky)).toBe(false); // a key item by chance is not a boss
    expect(m.isBossFight(crate)).toBe(false); // objects are never bosses
    expect(m.isBossFight(gen('G3', 2, { normal: 'nB' }))).toBe(false); // Ogremon's other spawner
    expect(m.speciesKind('Ogremon')).toBe('boss');
    expect(m.speciesKind('Goburimon')).toBe('enemy');
    expect(m.speciesKind('Box')).toBe('object');
  });

  it('reads per-player drop tables too', () => {
    const m = model();
    m.raw.drops.pools.nID = pool(['impItem', 0, 10000]);
    const g = {
      ...gen('G9', 1, undefined),
      players: [{ count: 1, maxCount: 1, lastDrops: { normal: 'nID' } }],
    };
    expect(m.isBossFight(g)).toBe(true);
  });

  it('counts a spawner with a boss health bar', () => {
    expect(model().isBossFight({ ...gen('G9', 1, undefined), bossHealthBar: true })).toBe(true);
  });
});
