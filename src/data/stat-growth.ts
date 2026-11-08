import type { SaveStats } from './types';

export type GrowthCurve = 'hp-mp' | 'stat';
export type GrowthStat = 'hp' | 'mp' | 'strength' | 'defense' | 'wisdom' | 'spirit' | 'speed';
export type DigimonForm = SaveStats['forms'][number];

/** The two retail level curves, shared by every playable form. */
export const GROWTH_BANDS = [
  { ceiling: 5, origin: 1, hpOffset: 0, hpRate: 10, statOffset: 0, statRate: 10 },
  { ceiling: 10, origin: 5, hpOffset: 40, hpRate: 20, statOffset: 40, statRate: 9 },
  { ceiling: 20, origin: 10, hpOffset: 140, hpRate: 50, statOffset: 85, statRate: 8 },
  { ceiling: 30, origin: 20, hpOffset: 640, hpRate: 80, statOffset: 165, statRate: 7 },
  { ceiling: 50, origin: 30, hpOffset: 1440, hpRate: 120, statOffset: 235, statRate: 6 },
  { ceiling: 70, origin: 50, hpOffset: 3840, hpRate: 180, statOffset: 355, statRate: 5 },
  { ceiling: 110, origin: 70, hpOffset: 7440, hpRate: 260, statOffset: 455, statRate: 4 },
  { ceiling: 150, origin: 110, hpOffset: 17840, hpRate: 180, statOffset: 615, statRate: 3 },
  { ceiling: 230, origin: 150, hpOffset: 25040, hpRate: 120, statOffset: 735, statRate: 2 },
  { ceiling: 999, origin: 230, hpOffset: 34640, hpRate: 80, statOffset: 895, statRate: 1 },
] as const;

export const GROWTH_STATS: { key: GrowthStat; label: string; curve: GrowthCurve; cap: number }[] = [
  { key: 'hp', label: 'HP', curve: 'hp-mp', cap: 99999 },
  { key: 'mp', label: 'MP', curve: 'hp-mp', cap: 99999 },
  { key: 'strength', label: 'Strength', curve: 'stat', cap: 9999 },
  { key: 'defense', label: 'Defense', curve: 'stat', cap: 9999 },
  { key: 'wisdom', label: 'Wisdom', curve: 'stat', cap: 9999 },
  { key: 'spirit', label: 'Spirit', curve: 'stat', cap: 9999 },
  { key: 'speed', label: 'Speed', curve: 'stat', cap: 9999 },
];

export function growthFactor(level: number, curve: GrowthCurve): number {
  if (!Number.isInteger(level) || level < 1 || level > 999) return NaN;
  const band = GROWTH_BANDS.find((b) => level <= b.ceiling)!;
  return curve === 'hp-mp'
    ? band.hpOffset + band.hpRate * (level - band.origin)
    : band.statOffset + band.statRate * (level - band.origin);
}

/** Base helper arithmetic, before equipment and temporary effects; multiplication is signed i32. */
export function levelGrowth(
  initial: number,
  growth: number,
  level: number,
  power: number,
  curve: GrowthCurve,
): number {
  if (
    !Number.isInteger(power) ||
    power < 0 ||
    power > 9999 ||
    !Number.isFinite(initial) ||
    !Number.isFinite(growth)
  )
    return NaN;
  const factor = growthFactor(level, curve);
  if (!Number.isFinite(factor)) return NaN;
  return Math.min(
    curve === 'hp-mp' ? 99999 : 9999,
    power + initial + Math.trunc(Math.imul(growth, factor) / 100),
  );
}

export function growthParameters(form: DigimonForm, stat: GrowthStat) {
  const initial = form[`${stat}Initial`];
  const growth = form[`${stat}Growth`];
  return Number.isInteger(initial) && Number.isInteger(growth)
    ? { initial: initial!, growth: growth! }
    : null;
}

export function naturalStat(form: DigimonForm, stat: GrowthStat, level: number): number {
  const parameters = growthParameters(form, stat);
  if (!parameters) return NaN;
  return levelGrowth(
    parameters.initial,
    parameters.growth,
    level,
    0,
    stat === 'hp' || stat === 'mp' ? 'hp-mp' : 'stat',
  );
}

/** Exact gain on reaching this level, including rounding and the stat cap. Level 1 has no gain. */
export function naturalGain(form: DigimonForm, stat: GrowthStat, level: number): number {
  const value = naturalStat(form, stat, level);
  return level === 1 && Number.isFinite(value) ? 0 : value - naturalStat(form, stat, level - 1);
}
