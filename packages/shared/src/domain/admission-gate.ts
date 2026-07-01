/**
 * admission-gate — the single decision the sign-in path consults.
 *
 * A Crew member is PENDING until the Organiser grants Admission, recorded on
 * `crew_member.admitted_at`. While that column is null the member must not be
 * issued a session; once it holds a timestamp they may sign in. Keeping the
 * rule in one pure function lets the `session.create.before` hook — which
 * covers password sign-in, the Google callback, and any auto-session — COMPOSE
 * the gate instead of re-deriving it.
 *
 * Pure: it reads a single field and performs no IO.
 */

/** The slice of a `crew_member` row the gate needs: just the Admission stamp. */
export interface AdmissionMember {
  /** When the Organiser admitted this member; null while still pending. */
  readonly admitted_at: Date | null;
}

/**
 * May a session be minted for this member?
 *
 * Returns `true` once Admission has been granted (`admitted_at` holds a
 * timestamp) and `false` while the member is still pending (`admitted_at` is
 * null). The comparison is intentionally loose (`!= null`) so the gate fails
 * closed: an absent or undefined stamp is treated as pending, never as cause
 * to mint a session.
 */
export function canMintSession(member: AdmissionMember): boolean {
  return member.admitted_at != null;
}
