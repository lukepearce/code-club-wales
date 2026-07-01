import { describe, it, expect } from 'vitest';

import { SYNTHETIC_DOMAIN, forUsername, isSynthetic } from './synthetic-email.js';

describe('synthetic-email', () => {
  describe('forUsername', () => {
    it('derives the placeholder address from a username', () => {
      expect(forUsername('ada')).toBe('ada@synthetic.codeclub.wales');
    });

    it('builds the address under SYNTHETIC_DOMAIN', () => {
      expect(forUsername('grace')).toBe(`grace@${SYNTHETIC_DOMAIN}`);
    });
  });

  describe('isSynthetic', () => {
    it('is true for a synthetic placeholder', () => {
      expect(isSynthetic('ada@synthetic.codeclub.wales')).toBe(true);
    });

    it('recognises any address forUsername mints (round-trip)', () => {
      expect(isSynthetic(forUsername('linus'))).toBe(true);
    });

    it('is false for a real address', () => {
      expect(isSynthetic('kid@gmail.com')).toBe(false);
    });

    it('rejects a look-alike domain', () => {
      expect(isSynthetic('kid@notsynthetic.codeclub.wales')).toBe(false);
    });

    it('matches the domain case-insensitively', () => {
      expect(isSynthetic('Ada@Synthetic.CodeClub.Wales')).toBe(true);
    });
  });
});
