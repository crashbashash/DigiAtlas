import { expect, it } from 'vitest';
import { validateRelease } from '../tools/check-release.mjs';

it('keeps release asset names aligned with the application version', () => {
  expect(validateRelease('v0.2.0', { ui: '0.2.0', native: '0.2.0' })).toBe('0.2.0');
  expect(() => validateRelease('v0.2.0', { ui: '0.2.0', native: '0.1.0' })).toThrow('native');
  for (const tag of ['0.2.0', 'v0.2.0-beta.1', 'v01.2.0', 'v0.2.0+local', 'v2'])
    expect(() => validateRelease(tag, {})).toThrow('stable versions');
});
