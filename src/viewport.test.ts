import { describe, expect, it } from 'vitest';
import { MAX_SCALE, zoomAt } from './viewport';

describe('zoomAt', () => {
  it('keeps the anchor point fixed', () => {
    const v = zoomAt({ x: 10, y: 20, scale: 1 }, 100, 100, 2);
    expect((100 - v.x) / v.scale).toBeCloseTo((100 - 10) / 1);
    expect((100 - v.y) / v.scale).toBeCloseTo((100 - 20) / 1);
  });
  it('clamps scale', () => {
    expect(zoomAt({ x: 0, y: 0, scale: MAX_SCALE }, 0, 0, 10).scale).toBe(MAX_SCALE);
  });
});
