import { describe, it, expect } from 'vitest';

import { WINDOW_MS, open, isOpen, consume } from './reset-window.js';

// A fixed reference instant so every test drives the clock explicitly rather
// than depending on the real wall clock.
const NOW = new Date('2026-06-30T12:00:00.000Z');

describe('reset-window', () => {
  describe('WINDOW_MS', () => {
    it('is five minutes expressed in milliseconds', () => {
      expect(WINDOW_MS).toBe(300_000);
      expect(WINDOW_MS).toBe(5 * 60 * 1000);
    });
  });

  describe('open', () => {
    it('returns a Date exactly WINDOW_MS (5 minutes) after now', () => {
      const until = open(NOW);
      expect(until).toBeInstanceOf(Date);
      expect(until.getTime()).toBe(NOW.getTime() + WINDOW_MS);
      expect(until.getTime() - NOW.getTime()).toBe(5 * 60 * 1000);
    });

    it('does not mutate the provided now', () => {
      const before = NOW.getTime();
      open(NOW);
      expect(NOW.getTime()).toBe(before);
    });
  });

  describe('isOpen', () => {
    it('is false when no window is set (reset_allowed_until is null)', () => {
      expect(isOpen({ reset_allowed_until: null }, NOW)).toBe(false);
    });

    it('is true at the very start of the window (now strictly before close)', () => {
      const member = { reset_allowed_until: open(NOW) };
      expect(isOpen(member, NOW)).toBe(true);
    });

    it('is true partway through the window', () => {
      const member = { reset_allowed_until: open(NOW) };
      const halfway = new Date(NOW.getTime() + WINDOW_MS / 2);
      expect(isOpen(member, halfway)).toBe(true);
    });

    it('is false exactly at the closing instant (now === close)', () => {
      const until = open(NOW);
      expect(isOpen({ reset_allowed_until: until }, new Date(until.getTime()))).toBe(false);
    });

    it('is false one millisecond after the window has expired', () => {
      const until = open(NOW);
      const expired = new Date(until.getTime() + 1);
      expect(isOpen({ reset_allowed_until: until }, expired)).toBe(false);
    });

    it('is false well after expiry', () => {
      const member = { reset_allowed_until: open(NOW) };
      const wayLater = new Date(NOW.getTime() + WINDOW_MS * 10);
      expect(isOpen(member, wayLater)).toBe(false);
    });
  });

  describe('consume', () => {
    it('within the window returns ok true and a cleared (null) window to persist', () => {
      const member = { reset_allowed_until: open(NOW) };
      const oneMinuteIn = new Date(NOW.getTime() + 60 * 1000);
      expect(consume(member, oneMinuteIn)).toEqual({
        ok: true,
        reset_allowed_until: null,
      });
    });

    it('after the window has expired returns ok false', () => {
      const until = open(NOW);
      const expired = new Date(until.getTime() + 1);
      expect(consume({ reset_allowed_until: until }, expired)).toEqual({ ok: false });
    });

    it('with no open window (null) returns ok false', () => {
      expect(consume({ reset_allowed_until: null }, NOW)).toEqual({ ok: false });
    });

    it('does not leak any window value on refusal', () => {
      const result = consume({ reset_allowed_until: null }, NOW);
      expect(result.ok).toBe(false);
      expect('reset_allowed_until' in result).toBe(false);
    });
  });
});
