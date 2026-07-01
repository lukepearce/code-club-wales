import { describe, expect, it } from 'vitest';

import { bootstrap, isOrganiser } from './organiser-policy.js';

describe('organiser-policy', () => {
  describe('isOrganiser', () => {
    it('is true when the member carries the organiser flag', () => {
      expect(isOrganiser({ is_organiser: true })).toBe(true);
    });

    it('is false when the member does not carry the organiser flag', () => {
      expect(isOrganiser({ is_organiser: false })).toBe(false);
    });
  });

  describe('bootstrap', () => {
    const organiserUsernames = ['ada', 'grace'];

    it('flags AND admits a username that is in the configured list', () => {
      expect(bootstrap('ada', organiserUsernames)).toEqual({
        is_organiser: true,
        admit: true,
      });
    });

    it('matches case-insensitively (candidate normalized)', () => {
      expect(bootstrap('ADA', organiserUsernames)).toEqual({
        is_organiser: true,
        admit: true,
      });
    });

    it('matches despite surrounding whitespace on the candidate', () => {
      expect(bootstrap('   ada   ', organiserUsernames)).toEqual({
        is_organiser: true,
        admit: true,
      });
    });

    it('matches when the configured entry itself has stray case/whitespace', () => {
      expect(bootstrap('grace', ['  GRACE '])).toEqual({
        is_organiser: true,
        admit: true,
      });
    });

    it('denies both flags to a username that is not in the list', () => {
      expect(bootstrap('mallory', organiserUsernames)).toEqual({
        is_organiser: false,
        admit: false,
      });
    });

    it('denies both flags when no organisers are configured', () => {
      expect(bootstrap('ada', [])).toEqual({
        is_organiser: false,
        admit: false,
      });
    });
  });
});
