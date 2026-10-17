import { describe, expect, it } from 'vitest';
import { errorText, percent } from './DiscImport';

describe('import progress', () => {
  it('turns steps into a whole percentage', () => {
    expect(percent(null)).toBe(0);
    expect(percent({ done: 0, total: 0, message: '' })).toBe(0);
    expect(percent({ done: 1, total: 3, message: '' })).toBe(33);
    expect(percent({ done: 100, total: 100, message: '' })).toBe(100);
    expect(percent({ done: 5, total: 4, message: '' })).toBe(100);
  });

  it('shows errors as sentences', () => {
    expect(errorText(new Error('this does not look like the disc'))).toBe(
      'This does not look like the disc',
    );
    expect(errorText('An import is already running.')).toBe('An import is already running.');
  });
});
