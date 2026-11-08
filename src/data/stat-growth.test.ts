import { describe, expect, it } from 'vitest';
import {
  growthFactor,
  levelGrowth,
  naturalGain,
  naturalStat,
  type DigimonForm,
} from './stat-growth';

const form: DigimonForm = {
  species: 0,
  name: 'Test form',
  model: '',
  hpInitial: 170,
  hpGrowth: 110,
  mpInitial: 60,
  mpGrowth: 100,
  strengthInitial: 94,
  strengthGrowth: 110,
  defenseInitial: 110,
  defenseGrowth: 90,
  wisdomInitial: 65,
  wisdomGrowth: 100,
  spiritInitial: 77,
  spiritGrowth: 100,
  speedInitial: 60,
  speedGrowth: 90,
};

describe('retail level curves', () => {
  it('covers both sides of every level-band transition and the final level', () => {
    for (const [level, hp, stat] of [
      [1, 0, 0],
      [5, 40, 40],
      [6, 60, 49],
      [10, 140, 85],
      [11, 190, 93],
      [20, 640, 165],
      [21, 720, 172],
      [30, 1440, 235],
      [31, 1560, 241],
      [50, 3840, 355],
      [51, 4020, 360],
      [70, 7440, 455],
      [71, 7700, 459],
      [110, 17840, 615],
      [111, 18020, 618],
      [150, 25040, 735],
      [151, 25160, 737],
      [230, 34640, 895],
      [231, 34720, 896],
      [999, 96160, 1664],
    ]) {
      expect(growthFactor(level, 'hp-mp'), `HP/MP at ${level}`).toBe(hp);
      expect(growthFactor(level, 'stat'), `stats at ${level}`).toBe(stat);
    }
  });

  it('rounds totals before deriving per-level gains and stops gaining at the cap', () => {
    expect(levelGrowth(100, 50, 10, 20, 'stat')).toBe(162);
    const slow = { ...form, strengthInitial: 100, strengthGrowth: 15 };
    expect(naturalStat(slow, 'strength', 2)).toBe(101);
    expect(naturalStat(slow, 'strength', 3)).toBe(103);
    expect(naturalGain(slow, 'strength', 2)).toBe(1);
    expect(naturalGain(slow, 'strength', 3)).toBe(2);
    const capped = {
      ...form,
      strengthInitial: 9995,
      strengthGrowth: 100,
      hpInitial: 99995,
      hpGrowth: 100,
    };
    expect(naturalStat(capped, 'strength', 2)).toBe(9999);
    expect(naturalGain(capped, 'strength', 2)).toBe(4);
    expect(naturalGain(capped, 'strength', 3)).toBe(0);
    expect(naturalStat(capped, 'hp', 2)).toBe(99999);
    expect(naturalGain(capped, 'hp', 2)).toBe(4);
    expect(naturalGain(capped, 'hp', 3)).toBe(0);
  });

  it('uses each form’s parameters and keeps HP/MP separate from the five attributes', () => {
    expect(naturalStat(form, 'hp', 1)).toBe(170);
    expect(naturalStat(form, 'hp', 2)).toBe(181);
    expect(naturalStat(form, 'mp', 2)).toBe(70);
    expect(naturalStat(form, 'strength', 2)).toBe(105);
    expect(naturalStat(form, 'defense', 2)).toBe(119);
    expect(naturalStat(form, 'speed', 2)).toBe(69);
    expect(naturalStat(form, 'hp', 100)).toBe(16934);
    expect(naturalStat(form, 'strength', 100)).toBe(726);
    expect(naturalStat({ ...form, strengthGrowth: 200 }, 'strength', 100)).toBe(1244);
    expect(naturalGain(form, 'hp', 1)).toBe(0);
  });

  it('rejects invalid levels and missing data instead of inventing growth', () => {
    for (const level of [0, 1000, 1.5, NaN, Infinity]) {
      expect(growthFactor(level, 'hp-mp')).toBeNaN();
      expect(naturalStat(form, 'strength', level)).toBeNaN();
      expect(naturalGain(form, 'strength', level)).toBeNaN();
    }
    expect(naturalStat({ ...form, hpGrowth: undefined }, 'hp', 10)).toBeNaN();
    expect(naturalStat({ ...form, spiritInitial: undefined }, 'spirit', 10)).toBeNaN();
    for (const power of [-1, 10000, 1.5, NaN])
      expect(levelGrowth(100, 100, 10, power, 'stat')).toBeNaN();
  });
});
