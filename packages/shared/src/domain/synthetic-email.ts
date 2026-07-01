/**
 * synthetic-email — derive and recognise the internal placeholder email used
 * for username-only joins.
 *
 * A crew member may join with a username and no real email. Better Auth's core
 * `user` row still expects an email, so we synthesise a deterministic,
 * non-deliverable address under a domain we own but never send to. This module
 * is the single source of truth for that address shape, so the rest of the
 * system can both MINT a synthetic email and later RECOGNISE one.
 *
 * Pure: no IO. The username is concatenated verbatim — callers normalise it via
 * username-policy before minting.
 */

/** Domain that backs every synthetic, non-deliverable crew email. */
export const SYNTHETIC_DOMAIN = 'synthetic.codeclub.wales';

/**
 * Derive the synthetic placeholder email for a username.
 *
 * The username is used verbatim (callers are expected to have normalised it
 * with username-policy first). Returns `username@synthetic.codeclub.wales`.
 */
export function forUsername(username: string): string {
  return `${username}@${SYNTHETIC_DOMAIN}`;
}

/**
 * True when `email`'s domain is exactly {@link SYNTHETIC_DOMAIN}, i.e. it is one
 * of our synthetic placeholders rather than a real address.
 *
 * Matching is case-insensitive (email domains are) and anchored on the `@`, so
 * look-alikes such as `x@notsynthetic.codeclub.wales` are correctly rejected.
 */
export function isSynthetic(email: string): boolean {
  return email.toLowerCase().endsWith(`@${SYNTHETIC_DOMAIN}`);
}
