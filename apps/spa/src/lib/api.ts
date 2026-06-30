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
