import { describe, expect, it } from 'vitest';
import type { Enemy, MpTech } from './types';
import {
  applicationValue,
  mpDamage,
  mpDuration,
  powerDownReductions,
  powerUpBoosts,
  venomPoison,
} from './mp-tech';
import { powerDownChance } from './power';
import { damageSpread } from './weapon-damage';

const venom: MpTech = {
  kind: 'venom',
  grade: 'Petty',
  row: 20,
  skill: 'blast',
  element: 'poison',
  mpCost: 16,
  power: 80,
  baseFrames: 600,
  criticalRate: 2,
  boosts: { maxHp: 0, strength: 0, defense: 0 },
};
const up: MpTech = {
  ...venom,
  kind: 'power-up',
  skill: 'force',
  element: 'none',
  power: 0,
  baseFrames: 1800,
  boosts: { maxHp: 80, strength: 80, defense: 80 },
};
const down: MpTech = {
  ...up,
  kind: 'power-down',
  baseFrames: 1200,
  boosts: { maxHp: 0, strength: -80, defense: -30 },
};
const enemy = { stats: { strength: 100, defense: 200 } } as Enemy;

describe('retail MP Tech calculations', () => {
  it('separates the direct hit, critical roll, poison roll, duration and tick damage', () => {
    const d = mpDamage(venom, 550, 1000, 200, 150)!;
    expect(d.rawBase).toBe(60);
    expect(d.damage).toBe(51);
    expect(d.normal).toEqual(damageSpread(51));
    expect(d.bonus).toBe(80);
    expect(d.criticalDamage).toBe(91);
    expect(d.critical).toEqual(damageSpread(91));
    expect([d.criticalDivisor, d.criticalScale, d.criticalThreshold, d.criticalChance]).toEqual([
      230, 43, 43, 4.3,
    ]);
    const p = venomPoison(venom, 551, 1000, 150)!;
    expect(p).toEqual({ a: 1000, threshold: 850, chance: 85, frames: 875, damage: 16 });
    expect(p.frames / 50).toBe(17.5);
    expect(p.frames / 60).toBeCloseTo(14.5833333);
  });
  it('checks every skill band and nominal poison-roll boundary', () => {
    expect([0, 999, 1000, 1001, 2000, 2001, 9999].map((s) => applicationValue(s, true))).toEqual([
      750, 999, 1000, 1000, 1200, 1200, 1999,
    ]);
    for (const skill of [0, 999, 1000, 1001, 2000, 2001, 9999]) {
      const a = applicationValue(skill)!;
      expect(powerDownChance(skill, 500)).toBe(Math.min(100, Math.floor((100 * a) / 500) / 10));
    }
    expect(venomPoison(venom, 0, 0, 333)?.chance).toBe(50);
    expect(venomPoison(venom, 0, 0, 0)?.chance).toBe(75);
    expect(venomPoison(venom, 0, 9999, 0)?.chance).toBe(100);
    expect(venomPoison(venom, 0, 1000, 999)?.chance).toBe(0.1);
    for (const r of [1000, 1500, 32767]) expect(venomPoison(venom, 0, 1000, r)?.chance).toBe(0);
  });
  it('uses caster Force for flat buffs and the 80% cap separately on each debuffed enemy stat', () => {
    expect(powerUpBoosts(up, 1000)).toEqual({ maxHp: 280, strength: 280, defense: 280 });
    expect(powerUpBoosts(up, 9999)?.strength).toBe(2079);
    expect(powerDownReductions(down, 1000, enemy)).toEqual({ strength: 80, defense: 80 });
    expect(powerDownReductions(down, 0, enemy)).toEqual({ strength: 80, defense: 30 });
    expect(
      powerDownReductions(down, 1000, { stats: { strength: 99, defense: 1 } } as Enemy),
    ).toEqual({ strength: 79, defense: 0 });
    expect(mpDuration(up, 551)).toBe(2351);
    expect(mpDuration(down, 551)).toBe(1475);
  });
  it('caps the first base before resistance, then caps again before critical and spread', () => {
    const d = mpDamage(venom, 9999, 9999, 1, 500)!;
    expect(d.rawBase).toBeGreaterThan(99999);
    expect(d.base).toBe(99999);
    expect(d.damage).toBe(49999);
    expect(d.criticalDamage).toBe(139497);
    expect(d.critical).toEqual({ min: 99999, max: 99999, mean: 99999 });
    expect(mpDamage(venom, 550, 1000, 0, 150)?.normal.max).toBe(0);
    expect(mpDamage(venom, 550, 1000, -1, 150)?.normal.max).toBe(0);
    expect(mpDamage(venom, 550, 1000, 200, 1000)?.normal.max).toBe(0);
    expect(mpDamage({ ...venom, power: 0 }, 550, 1000, 200, 150)?.normal.max).toBe(0);
    // Negative resistance can overflow the retail signed 32-bit elemental product.
    expect(mpDamage(venom, 9999, 9999, 1, -32768)?.damage).toBe(0);
  });
  it('uses technique critical data rather than weapon critical rate and safely handles the EE zero divisor', () => {
    const fire = { ...venom, kind: 'fire', element: 'fire', power: 160 } as MpTech;
    expect(mpDamage(fire, 550, 1000, 200, 100)?.criticalChance).toBe(5.9);
    expect(mpDamage(fire, 550, 1000, 200, -42)?.criticalDivisor).toBe(0);
    expect(mpDamage(fire, 550, 1000, 200, -42)?.criticalChance).toBe(0);
    for (const invalid of [NaN, Infinity, -1, 1.5, 10000]) {
      expect(mpDamage(venom, invalid, 1000, 200, 150)).toBeNull();
      expect(mpDamage(venom, 550, invalid, 200, 150)).toBeNull();
      expect(venomPoison(venom, 550, invalid, 150)).toBeNull();
      expect(powerUpBoosts(up, invalid)).toBeNull();
    }
    expect(mpDamage(up, 550, 1000, 200, 150)).toBeNull();
  });
});

it('covers healing, buffs, cures, control durations and non-elemental critical rolls', async () => {
  const { healingAmount, speedEffects, cureChance } = await import('./mp-tech');
  const heal = { ...up, kind: 'heal-light', skill: 'heal', healBase: 300 } as MpTech;
  expect(healingAmount(heal, 550, 1000)).toBe(1850);
  const speed = {
    ...up,
    kind: 'speed',
    criticalRate: 3,
    boosts: { ...up.boosts, speed: 100, hitRate: 3, evasion: 5 },
  } as MpTech;
  expect(speedEffects(speed, 1000)).toEqual({
    speed: 300,
    criticalRate: 3,
    hitRate: 3,
    evasion: 5,
  });
  expect(mpDuration(speed, 551)).toBe(2351);
  const freeze = {
    ...speed,
    kind: 'freeze',
    baseFrames: 1200,
    criticalRate: -3,
    boosts: { ...speed.boosts, speed: -25, hitRate: -3, evasion: -5 },
  } as MpTech;
  expect(speedEffects(freeze, 1000, { stats: { speed: 50 } } as Enemy)).toEqual({
    speed: -40,
    criticalRate: -3,
    hitRate: -3,
    evasion: -5,
  });
  expect(mpDuration(freeze, 551)).toBe(1475);
  expect(mpDuration({ ...up, kind: 'resist' }, 9999)).toBe(1800);
  for (const kind of ['sleep', 'bind'] as const)
    expect(mpDuration({ ...down, kind }, 551)).toBe(1475);
  const cure = { ...heal, kind: 'cure-light', row: 55 } as MpTech;
  expect([0, 1, 5, 6, 10].map((p) => cureChance(cure, p))).toEqual([60, 50, 10, 0, 0]);
  expect(cureChance({ ...cure, row: 59 }, 0)).toBe(100);
  expect(cureChance({ ...cure, row: 59 }, 9)).toBe(10);
  const impact = {
    ...venom,
    kind: 'impact',
    element: 'none',
    power: 240,
    criticalRate: 3,
  } as MpTech;
  expect(mpDamage(impact, 550, 1000, 200, 0)?.criticalChance).toBe(3);
  expect(mpDamage(impact, 550, 1000, 200, 0)?.damage).toBe(76);
});
