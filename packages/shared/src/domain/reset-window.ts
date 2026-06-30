// reset-window — the Organiser-opened, email-free password reset window.
//
// v1 auth sends no email (ADR: no magic-link). Instead the Organiser opens a
// short, time-boxed window during which a waiting crew member may set a new
// password. This module is the pure policy for that window: it knows how long
// a window lasts, whether one is currently open, and how to consume it.
//
// Pure: no DB, no clock, no network. The current time is injected by callers
// (`now`) so the policy is deterministic and trivially testable. The COORDINATOR
// (the reset slice) is responsible for the side effects — it sets the password
// via Better Auth's server API, then persists the cleared value this module
// yields. This module never touches persistence itself.

/** How long an Organiser-opened reset window stays open: 5 minutes, in ms. */
export const WINDOW_MS = 300_000;

/**
 * The slice of a crew member this module reasons about. Structural on purpose
 * so any row/record carrying `reset_allowed_until` satisfies it.
 */
export interface ResetWindowMember {
  /**
   * When the current reset window closes, or `null` when no window is open.
   * Maps to the `crew_member.reset_allowed_until` timestamptz column.
   */
  reset_allowed_until: Date | null;
}

/** The outcome of consuming a window: either a cleared value to persist, or a refusal. */
export type ConsumeResult =
  | { ok: true; reset_allowed_until: null }
  | { ok: false };

/**
 * Open a window starting now: returns the instant the window will close,
 * exactly `WINDOW_MS` after `now`. Does not mutate `now`.
 */
export function open(now: Date): Date {
  return new Date(now.getTime() + WINDOW_MS);
}

/**
 * Is a reset window currently open for this member? True only when the member
 * has a window set (`reset_allowed_until != null`) and `now` is strictly before
 * it. At or after the closing instant the window is closed.
 */
export function isOpen(member: ResetWindowMember, now: Date): boolean {
  const until = member.reset_allowed_until;
  return until !== null && now.getTime() < until.getTime();
}

/**
 * Consume the window: if one is open, yield the cleared value (`null`) for the
 * coordinator to persist after it sets the new password — so the window cannot
 * be reused. If no window is open (or it has expired), refuse.
 *
 * Composes `isOpen`; it does not re-derive the window logic.
 */
export function consume(member: ResetWindowMember, now: Date): ConsumeResult {
  if (!isOpen(member, now)) {
    return { ok: false };
  }
  return { ok: true, reset_allowed_until: null };
}
