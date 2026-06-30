import { describe, expect, it } from 'vitest';
import { canMintSession } from './admission-gate.js';

describe('admission-gate / canMintSession', () => {
  it('refuses a session for a pending member (admitted_at is null)', () => {
    expect(canMintSession({ admitted_at: null })).toBe(false);
  });

  it('allows a session for an admitted member (admitted_at is a Date)', () => {
    expect(canMintSession({ admitted_at: new Date('2026-01-01T00:00:00Z') })).toBe(true);
  });

  it('is a binary gate, not time-bounded: any admission stamp permits a session', () => {
    // Unlike the reset window, Admission has no expiry — a stamp far in the
    // past and one taken right now both let the member sign in.
    expect(canMintSession({ admitted_at: new Date(0) })).toBe(true);
    expect(canMintSession({ admitted_at: new Date() })).toBe(true);
  });
});
