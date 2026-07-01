import { describe, expect, it } from 'vitest';
import { SHARED_PACKAGE_NAME } from '../src/index.js';

describe('@codeclub/shared', () => {
  it('exposes its package marker', () => {
    expect(SHARED_PACKAGE_NAME).toBe('@codeclub/shared');
  });
});
