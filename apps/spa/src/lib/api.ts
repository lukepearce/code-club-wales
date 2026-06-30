// Thin client for the API's own (non-Better-Auth) endpoints. Better Auth calls
// go through authClient; this covers the public join endpoint.

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface JoinRequest {
  username: string;
  password: string;
  email?: string | undefined;
}

export type JoinResponse =
  | { ok: true; username: string }
  | { ok: false; error: string; reasons?: string[]; message?: string };

/** POST /api/join. Resolves to the parsed body (never throws on HTTP status). */
export async function requestJoin(input: JoinRequest): Promise<JoinResponse> {
  try {
    const res = await fetch(`${API_URL}/api/join`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return (await res.json()) as JoinResponse;
  } catch {
    return { ok: false, error: 'network', message: 'Could not reach the server. Try again.' };
  }
}

// ---------------------------------------------------------------------------
// Organiser surface (gated server-side: the API answers 403 to non-Organisers).
// ---------------------------------------------------------------------------

/** A Crew member as the Organiser area renders it (mirrors OrganiserMemberView). */
export interface OrganiserMember {
  userId: string;
  username: string | null;
  displayUsername: string | null;
  displayName: string;
  isOrganiser: boolean;
  /** ISO timestamp, or null while pending. */
  admittedAt: string | null;
  createdAt: string;
  status: 'pending' | 'active';
}

/**
 * Thrown when the API refuses the Organiser surface — the caller is not signed
 * in as an Organiser. The route guard turns this into a redirect; the page turns
 * it into an "Organisers only" panel.
 */
export class OrganiserForbiddenError extends Error {
  constructor() {
    super('Organisers only.');
    this.name = 'OrganiserForbiddenError';
  }
}

/** TanStack Query key for the members list (shared by the route guard + page). */
export const ORGANISER_MEMBERS_QUERY_KEY = ['organiser', 'members'] as const;

/** GET /api/organiser/members. Throws OrganiserForbiddenError on 401/403. */
export async function fetchOrganiserMembers(): Promise<OrganiserMember[]> {
  const res = await fetch(`${API_URL}/api/organiser/members`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
  });
  if (res.status === 401 || res.status === 403) {
    throw new OrganiserForbiddenError();
  }
  if (!res.ok) {
    throw new Error('Could not load members.');
  }
  const body = (await res.json()) as { ok: true; members: OrganiserMember[] };
  return body.members;
}

async function organiserAction(userId: string, action: 'admit' | 'reject'): Promise<void> {
  const res = await fetch(
    `${API_URL}/api/organiser/members/${encodeURIComponent(userId)}/${action}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
    },
  );
  if (res.status === 401 || res.status === 403) {
    throw new OrganiserForbiddenError();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Could not ${action} the member.`);
  }
}

/** POST /api/organiser/members/:id/admit. */
export function admitMember(userId: string): Promise<void> {
  return organiserAction(userId, 'admit');
}

/** POST /api/organiser/members/:id/reject. */
export function rejectMember(userId: string): Promise<void> {
  return organiserAction(userId, 'reject');
}
