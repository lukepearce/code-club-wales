/**
 * Username policy — the canonical identity rules for Crew members.
 *
 * Pure: no IO, no DB, no network. Apps COMPOSE these helpers; they never
 * reimplement the rules. A raw candidate is reduced to a single canonical form
 * (trimmed + lowercased) and then checked against length, charset, and a
 * reserved list before it can become a Crew member's identity.
 */

/** Minimum length of a normalized username (inclusive). */
const MIN_LENGTH = 3;

/** Maximum length of a normalized username (inclusive). */
const MAX_LENGTH = 20;

/** A normalized username may only contain a-z, 0-9, underscore, and hyphen. */
const USERNAME_PATTERN = /^[a-z0-9_-]+$/;

/**
 * Names that must never become a username — they collide with system
 * subdomains, routes, or roles. Compared against the NORMALIZED candidate, so
 * casing and surrounding whitespace cannot smuggle one past the gate.
 */
export const RESERVED_USERNAMES: readonly string[] = [
  'www',
  'my',
  'api',
  'auth',
  'mail',
  'admin',
  'docs',
  'crew',
  'learn',
];

/** The result of validating a raw username candidate. */
export type UsernameValidation =
  | { ok: true; value: string }
  | { ok: false; reasons: string[] };

/**
 * Reduce a raw candidate to its single canonical form: surrounding whitespace
 * trimmed and the whole string lowercased.
 *
 * Idempotent by construction — the output is already trimmed and lowercased, so
 * normalize(normalize(x)) === normalize(x).
 */
export function normalize(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Validate a raw username candidate. Normalizes first, then collects every
 * failure reason from the length, charset, and reserved-list checks. On success
 * it yields the canonical `value` that callers should persist as the identity.
 */
export function validate(raw: string): UsernameValidation {
  const value = normalize(raw);
  const reasons: string[] = [];

  if (value.length < MIN_LENGTH) {
    reasons.push(`Username must be at least ${MIN_LENGTH} characters.`);
  } else if (value.length > MAX_LENGTH) {
    reasons.push(`Username must be at most ${MAX_LENGTH} characters.`);
  }

  if (!USERNAME_PATTERN.test(value)) {
    reasons.push(
      'Username may only contain lowercase letters, numbers, underscores, and hyphens.',
    );
  }

  if (RESERVED_USERNAMES.includes(value)) {
    reasons.push('Username is reserved.');
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  return { ok: true, value };
}
