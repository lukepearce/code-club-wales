import { describe, expect, it } from 'vitest';
import { RESERVED_USERNAMES, normalize, validate } from './username-policy.js';

describe('username-policy: normalize', () => {
  it('trims surrounding whitespace and lowercases', () => {
    expect(normalize('  ABC  ')).toBe('abc');
    expect(normalize('Alice')).toBe('alice');
    expect(normalize('\t HELLO_World \n')).toBe('hello_world');
  });

  it('is idempotent: normalize(normalize(x)) === normalize(x)', () => {
    const samples = ['  Alice  ', 'BOB', 'weird   ', '  MiXeD-Case_1 ', '', 'aBc123'];
    for (const sample of samples) {
      const once = normalize(sample);
      expect(normalize(once)).toBe(once);
    }
  });

  it('maps differently-cased and differently-spaced inputs to the same canonical value', () => {
    expect(normalize('Alice')).toBe(normalize('  alice  '));
    expect(normalize('Alice')).toBe('alice');

    expect(normalize('  HELLO_World  ')).toBe(normalize('hello_world'));
    expect(normalize('  HELLO_World  ')).toBe('hello_world');
  });
});

describe('username-policy: validate', () => {
  it('accepts valid usernames and yields the canonical value', () => {
    const cases: Array<[string, string]> = [
      ['alice', 'alice'],
      ['bob123', 'bob123'],
      ['a_b-c', 'a_b-c'],
      ['cool_coder-7', 'cool_coder-7'],
      ['abc', 'abc'], // minimum length boundary (3)
      ['a'.repeat(20), 'a'.repeat(20)], // maximum length boundary (20)
      ['  Alice  ', 'alice'], // normalized before validation
    ];

    for (const [input, expected] of cases) {
      const result = validate(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(expected);
      }
    }
  });

  it('accepts underscores and hyphens as the only allowed symbols', () => {
    expect(validate('a-b').ok).toBe(true);
    expect(validate('a_b').ok).toBe(true);
    expect(validate('_-_').ok).toBe(true); // 3 chars, all allowed, not reserved
  });

  it('rejects usernames shorter than 3 characters', () => {
    for (const input of ['', 'a', 'ab', '  ab  ']) {
      const result = validate(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reasons.length).toBeGreaterThan(0);
      }
    }
  });

  it('rejects usernames longer than 20 characters', () => {
    for (const input of ['a'.repeat(21), 'a'.repeat(50)]) {
      const result = validate(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reasons.length).toBeGreaterThan(0);
      }
    }
  });

  it('rejects invalid characters (spaces and symbols other than _ or -)', () => {
    const invalid = [
      'ab cd', // internal space
      'foo!',
      'bar.baz',
      'a@b',
      'FOO BAR', // uppercase normalizes, but the internal space remains
      'naïve', // non-ascii letter
      'tab\tx', // internal tab
    ];
    for (const input of invalid) {
      expect(validate(input).ok).toBe(false);
    }
  });

  it('rejects every reserved username', () => {
    for (const name of RESERVED_USERNAMES) {
      expect(validate(name).ok).toBe(false);
    }
  });

  it('reserves the canonical set of names', () => {
    const expected = ['www', 'my', 'api', 'auth', 'mail', 'admin', 'docs', 'crew', 'learn'];
    for (const name of expected) {
      expect(RESERVED_USERNAMES).toContain(name);
    }
  });

  it('rejects reserved usernames regardless of case or surrounding whitespace', () => {
    expect(validate('ADMIN').ok).toBe(false);
    expect(validate('  Admin  ').ok).toBe(false);
    expect(validate('Www').ok).toBe(false);
  });

  it('reports failures as a non-empty list of human-readable string reasons', () => {
    const result = validate('!!');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Array.isArray(result.reasons)).toBe(true);
      expect(result.reasons.length).toBeGreaterThan(0);
      for (const reason of result.reasons) {
        expect(typeof reason).toBe('string');
      }
    }
  });
});
