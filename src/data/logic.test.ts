import { describe, expect, it } from 'vitest';
import { dropTable, formatPercent, groupByEnemy, isUnused, itemMatchesQuery, scriptRefText, startModeText } from './logic';
import type { Enemy, Generator } from './types';

describe('dropTable', () => {
  it('turns rates out of 10000 into percentages and a nothing chance', () => {
    const t = dropTable({
      totalRate: 4330,
      entries: [
        { category: 'weapon', id: 0, rank: 0, rate: 250 },
        { category: 'conItem', id: 1, rank: 0, rate: 4080 },
      ],
    });
    expect(t.rows.map((r) => [r.key, r.percent])).toEqual([
      ['conItem:1', 40.8],
      ['weapon:0', 2.5],
    ]);
    expect(t.nothingPercent).toBeCloseTo(56.7);
  });

  it('sums rank variants of the same item into one row', () => {
    const t = dropTable({
      totalRate: 500,
      entries: [1, 2, 3].map((rank) => ({ category: 'insItem', id: 0, rank, rate: 100 })).concat([
        { category: 'insItem', id: 0, rank: 4, rate: 200 },
      ]),
    });
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].percent).toBe(5);
  });

  it('never goes negative when a pool sums to more than 100 percent', () => {
    expect(dropTable({ totalRate: 10400, entries: [{ category: 'a', id: 0, rank: 0, rate: 10400 }] }).nothingPercent).toBe(0);
  });

  it('handles a missing pool', () => {
    expect(dropTable(null)).toEqual({ rows: [], nothingPercent: 100 });
  });
});

describe('formatPercent', () => {
  it('keeps small chances readable', () => {
    expect(formatPercent(40.8)).toBe('41%');
    expect(formatPercent(2.5)).toBe('2.5%');
    expect(formatPercent(0.25)).toBe('0.25%');
    expect(formatPercent(0.5)).toBe('0.5%');
    expect(formatPercent(1)).toBe('1%');
  });
});

describe('groupByEnemy', () => {
  const gen = (row: number, count: number, points: number): Generator => ({
    name: 'GENE', row, count, maxCount: 1, spawns: Array.from({ length: points }, () => [0, 0, 0] as [number, number, number]),
    rotations: [], startMode: 'direct', fillMode: 'wipeout',
  });
  it('groups spawners by what they spawn and totals them', () => {
    const enemies = new Map<number, Enemy>();
    const groups = groupByEnemy([gen(1, 2, 2), gen(5, 3, 1), gen(1, 4, 3)], enemies);
    expect(groups.map((g) => [g.row, g.spawners, g.points, g.total, g.generators])).toEqual([
      [1, 2, 5, 6, [0, 2]],
      [5, 1, 1, 3, [1]],
    ]);
  });
});

describe('startModeText', () => {
  it('explains the three start modes', () => {
    expect(startModeText('radar')).toMatch(/close/);
    expect(startModeText('direct')).toMatch(/script/);
    expect(startModeText('weird')).toBe('weird');
  });
});

describe('script helpers', () => {
  const base: Generator = {
    name: 'G', row: 1, count: 1, maxCount: 1, spawns: [[0, 0, 0]], rotations: [], startMode: 'direct', fillMode: 'wipeout',
  };
  const enemy = { kind: 'enemy' } as Enemy;

  it('flags only script-started spawners that nothing starts', () => {
    expect(isUnused({ ...base, script: { status: 'none' } }, enemy)).toBe(true);
    expect(isUnused({ ...base, script: { status: 'referenced' } }, enemy)).toBe(false);
    expect(isUnused({ ...base, startMode: 'radar', script: { status: 'none' } }, enemy)).toBe(false);
    expect(isUnused({ ...base, script: { status: 'none' } }, { kind: 'object' } as Enemy)).toBe(false);
    expect(isUnused(base, enemy)).toBe(false);
  });

  it('turns a script call into a sentence', () => {
    expect(scriptRefText({ verb: 'RESTART', when: ['event 339 not done yet'] })).toBe('Restarted when event 339 not done yet');
    expect(scriptRefText({ verb: 'START', when: [] })).toBe('Started with no condition');
  });
});

describe('itemMatchesQuery', () => {
  it('finds the unidentified items by that word', () => {
    const item = { category: 'weapon', id: 276, name: 'Unidentified Weapon', description: null, unidentified: true as const };
    expect(itemMatchesQuery(item, 'unidentified')).toBe(true);
    expect(itemMatchesQuery(item, 'unid')).toBe(true);
    expect(itemMatchesQuery(item, 'core')).toBe(false);
  });
});
