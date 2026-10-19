import { describe, expect, it } from 'vitest';
import {
  criticalBonus,
  damageSpread,
  weaponDamage,
  averageAttackDamage,
  type WeaponDamageInput,
} from './weapon-damage';
const input: WeaponDamageInput = {
  strength: 2000,
  skill: 1500,
  defense: 128,
  critChance: 10,
  element: 'none',
  resistance: 0,
};

describe('retail weapon damage', () => {
  it('matches the recovered physical numerator, skill-based critical bonus and live-observed bands', () => {
    const r = weaponDamage(input)!;
    expect(r.base).toBe(140);
    expect([r.normal.min, r.normal.max]).toEqual([133, 146]);
    expect(r.criticalBonus).toBe(90);
    expect([r.critical.min, r.critical.max]).toEqual([252, 279]);
    expect(r.average).toBeCloseTo(r.normal.mean * 0.9 + r.critical.mean * 0.1, 10);
  });
  it('preserves integer boundaries in the three critical bands', () => {
    expect(
      [0, 999, 1000, 1001, 1049, 1050, 2000, 2001, 2099, 2100, 9999].map(criticalBonus),
    ).toEqual([30, 79, 80, 80, 80, 81, 100, 100, 100, 101, 179]);
  });
  it('uses a strict elemental proc roll and adds the bonus before critical/spread', () => {
    const r = weaponDamage({
      ...input,
      strength: 1000,
      skill: 1000,
      defense: 100,
      element: 'fire',
      resistance: 500,
    })!;
    expect(r.base).toBe(100);
    expect(r.elementChance).toBe(49.9);
    expect(r.elementBonus).toBe(50);
    expect([r.normal.min, r.normal.max]).toEqual([95, 157]);
    expect(r.normal.mean).toBeCloseTo(
      damageSpread(100).mean * 0.501 + damageSpread(150).mean * 0.499,
      10,
    );
    expect(weaponDamage({ ...input, element: 'fire', resistance: 0 })!.elementChance).toBe(99.9);
    expect(weaponDamage({ ...input, element: 'fire', resistance: 998 })!.elementChance).toBe(0.1);
    for (const resistance of [999, 1000, 1500, 32767]) {
      const r = weaponDamage({ ...input, element: 'fire', resistance })!;
      expect(r.elementChance).toBe(0);
      expect(r.elementBonus).toBe(0);
      expect(r.normal).toEqual(weaponDamage(input)!.normal);
    }
  });
  it('matches an independent enumeration of all four random bands including the final cap', () => {
    for (const damage of [1, 2, 7, 19, 100, 137, 99980]) {
      // For the large capped case sample all remainders by quotient counts instead of millions of rolls.
      const counts = new Map<number, number>();
      for (const band of [950, 975, 1000, 1025]) {
        const first = band * damage,
          last = first + 25 * damage - 1;
        for (let result = Math.floor(first / 1000); result <= Math.floor(last / 1000); result++) {
          const n = Math.max(
            0,
            Math.min(last, (result + 1) * 1000 - 1) - Math.max(first, result * 1000) + 1,
          );
          const value = Math.min(99999, result);
          counts.set(value, (counts.get(value) ?? 0) + n);
        }
      }
      const r = damageSpread(damage);
      expect(r.min).toBe(Math.min(...counts.keys()));
      expect(r.max).toBe(Math.max(...counts.keys()));
      expect(r.mean).toBeCloseTo(
        [...counts].reduce((s, [v, n]) => s + v * n, 0) / (100 * damage),
        8,
      );
    }
  });
  it('handles zero/negative effective defense and zero damage without invalid RNG moduli', () => {
    for (const defense of [0, -1]) expect(weaponDamage({ ...input, defense })!.normal.max).toBe(0);
    expect(weaponDamage({ ...input, strength: 0, skill: 0 })!.average).toBe(0);
    expect(weaponDamage({ ...input, strength: 9999, skill: 9999, defense: 1 })!.critical.max).toBe(
      99999,
    );
  });
  it('rejects incomplete or out-of-domain manual stats', () => {
    for (const strength of [NaN, Infinity, -1, 10000, 0.5])
      expect(weaponDamage({ ...input, strength })).toBeNull();
    expect(weaponDamage({ ...input, critChance: 101 })).toBeNull();
    expect(weaponDamage({ ...input, element: 'fire', resistance: NaN })).toBeNull();
  });
});

describe('normal attack totals', () => {
  it('sums two hit attempts while leaving normal/critical per-hit damage and chances unchanged', () => {
    const result = weaponDamage(input)!;
    const original = structuredClone(result);
    expect(averageAttackDamage(result.average, 75, 2)).toBeCloseTo(
      2 * averageAttackDamage(result.average, 75, 1)!,
      10,
    );
    expect(result).toEqual(original);
    expect(averageAttackDamage(result.average, 0, 2)).toBe(0);
  });
  it('accounts for mixed normal/critical/miss outcomes by summing the joint distribution', () => {
    const result = weaponDamage(input)!;
    const possibilities = [
      { p: 0.25, d: 0 },
      { p: 0.75 * 0.9, d: result.normal.mean },
      { p: 0.75 * 0.1, d: result.critical.mean },
    ];
    const expected = possibilities.reduce(
      (sum, a) => sum + possibilities.reduce((inner, b) => inner + a.p * b.p * (a.d + b.d), 0),
      0,
    );
    expect(averageAttackDamage(result.average, 75, 2)).toBeCloseTo(expected, 10);
  });
  it('does not cap the combined total or accept invalid profiles', () => {
    expect(averageAttackDamage(99999, 100, 2)).toBe(199998);
    for (const count of [0, -1, 1.5, 17, NaN])
      expect(averageAttackDamage(100, 50, count)).toBeNull();
    expect(averageAttackDamage(100, -1, 2)).toBeNull();
    expect(averageAttackDamage(NaN, 100, 2)).toBeNull();
  });
});
