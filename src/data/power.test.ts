import { describe, expect, it } from 'vitest';
import { powerDownChance, powerDuration } from './power';
import { parseHash, formatHash, DEFAULT_SETTINGS } from '../app/route';

describe('player-cast power spells', () => {
  it('matches the recovered Infinity duration examples and rounds half Wisdom down', () => {
    expect(powerDuration({ kind: 'up', grade: 'Infinity', row: 84, baseFrames: 3240 }, 9999)).toBe(
      13239,
    );
    expect(
      powerDuration({ kind: 'down', grade: 'Infinity', row: 89, baseFrames: 2640 }, 9999),
    ).toBe(7639);
    expect(powerDuration({ kind: 'down', grade: 'Petty', row: 85, baseFrames: 1200 }, 1)).toBe(
      1200,
    );
  });
  it('matches the documented chance examples and all Force-band boundaries', () => {
    for (const [force, spirit, expected] of [
      [500, 1000, 6.7],
      [1000, 500, 16],
      [1000, 1000, 8],
      [2000, 500, 20],
      [3000, 500, 22],
      [9999, 250, 71.9],
      [1001, 500, 16],
      [2001, 500, 20],
      [0, 500, 11],
    ]) {
      expect(powerDownChance(force, spirit)).toBe(expected);
    }
    expect(powerDownChance(9999, 1)).toBe(100);
  });
  it('rejects empty, fractional, negative, out-of-range and zero-divisor inputs', () => {
    for (const force of [NaN, Infinity, -1, 1.5, 10000])
      expect(powerDownChance(force, 500)).toBeNull();
    for (const spirit of [0, -1, NaN, 2.5]) expect(powerDownChance(1000, spirit)).toBeNull();
  });
  it('opens calculators through a stable route with difficulty', () => {
    expect(parseHash(formatHash({ page: 'calculators' }, DEFAULT_SETTINGS))).toEqual({
      route: { page: 'calculators' },
      settings: { difficulty: 'hard' },
    });
  });
});
