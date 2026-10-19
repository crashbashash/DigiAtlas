import { expect, it } from 'vitest';
import { attackHitChance } from './attack-hit';

it('matches the retail 10,000-roll hit test, with truncation and caps', () => {
  expect(attackHitChance(1000, 1500, 78, 1000)).toBe(51.48);
  expect(attackHitChance(1000, 1500, 78, 1001)).toBe(51.42);
  expect(attackHitChance(1000, 1500, 78, 500)).toBe(100);
  expect(attackHitChance(1000, 1500, 0, 1000)).toBe(0);
  expect(attackHitChance(1000, 1500, 78, 0)).toBe(0);
  expect(attackHitChance(1000, 1500, 78, -1)).toBe(0);
});
it('agrees with an independent signed-word and exhaustive roll reference', () => {
  for (const speed of [0, 1, 999, 9999])
    for (const skill of [0, 800, 9999])
      for (const accuracy of [0, 78, 32767])
        for (const enemy of [1, 194, 1001, 32767]) {
          const product = Number(
            BigInt.asIntN(
              32,
              BigInt(accuracy) * (30n * BigInt(speed) + 20n * BigInt(skill) + 6000n),
            ),
          );
          const threshold = Number(BigInt(product) / BigInt(enemy));
          let successes = 0;
          for (let roll = 0; roll < 10000; roll++) if (roll < threshold) successes++;
          expect(attackHitChance(speed, skill, accuracy, enemy)).toBe(successes / 100);
        }
});
it('rejects incomplete and invalid hit inputs', () => {
  for (const values of [
    [NaN, 0, 78, 100],
    [10000, 0, 78, 100],
    [1, 1.5, 78, 100],
    [1, 0, -1, 100],
    [1, 0, 78, 32768],
  ])
    expect(attackHitChance(...(values as [number, number, number, number]))).toBeNull();
});
