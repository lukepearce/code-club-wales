// organiser-policy — who runs the club.
//
// An "Organiser" is the person who runs a Code Club; the domain flag is
// crew_member.is_organiser. This module answers two pure questions:
//
//   isOrganiser(member)  — does this crew member already carry the flag?
//   bootstrap(username, organiserUsernames)
//                        — at join time, should this username be made an
//                          Organiser (and admitted on the spot)?
//
// It COMPOSES the shared username `normalize` rather than reimplementing it, so
// the organiser comparison uses exactly the same canonical identity rules as
// the rest of the system. No DB, no network — pure policy.

import { normalize } from './username-policy.js';

/**
 * The slice of a crew_member that organiser policy reads. Structural, so a full
 * crew_member row (or any object carrying the flag) satisfies it.
 */
export interface OrganiserPolicyMember {
  readonly is_organiser: boolean;
}

/** The decision produced by {@link bootstrap} for a joining username. */
export interface BootstrapDecision {
  /** Whether the new crew_member should carry the Organiser flag. */
  is_organiser: boolean;
  /** Whether the new crew_member should be admitted immediately (no gate). */
  admit: boolean;
}

/** True when this crew member carries the Organiser flag. */
export function isOrganiser(member: OrganiserPolicyMember): boolean {
  return member.is_organiser;
}

/**
 * Decide, at join time, whether `username` belongs to a pre-configured
 * Organiser. The match is case- and whitespace-insensitive: both the candidate
 * and every configured name are run through the shared `normalize`, so 'Ada',
 * ' ada ' and 'ada' are one identity. A configured Organiser is both flagged
 * (is_organiser) and admitted on the spot (admit); everyone else gets both
 * false and must wait for Admission like any other crew member.
 */
export function bootstrap(
  username: string,
  organiserUsernames: readonly string[],
): BootstrapDecision {
  const candidate = normalize(username);
  const isConfiguredOrganiser = organiserUsernames.some(
    (name) => normalize(name) === candidate,
  );
  return { is_organiser: isConfiguredOrganiser, admit: isConfiguredOrganiser };
}
