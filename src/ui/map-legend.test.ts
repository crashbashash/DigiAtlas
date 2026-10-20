import { describe, expect, it } from 'vitest';
import { hasHeightVariation } from './map-legend';

describe('height legend', () => {
  it('omits the key for a flat floor, even with transparent areas and grey scenery', () => {
    expect(
      hasHeightVariation(
        new Uint8ClampedArray([
          0, 0, 0, 0, 196, 218, 232, 255, 57, 72, 89, 255, 196, 218, 232, 255,
        ]),
      ),
    ).toBe(false);
  });
  it('shows the key when floor height colours visibly differ', () => {
    expect(
      hasHeightVariation(new Uint8ClampedArray([108, 150, 182, 255, 218, 238, 250, 255])),
    ).toBe(true);
  });
});
