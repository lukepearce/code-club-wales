import { usernameClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Points at the Hono API; Better Auth appends its /api/auth base path itself.
// The Google social provider is configured server-side; signIn.social('google')
// is available on this client (no extra plugin needed).
export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [usernameClient()],
});

export type AuthClient = typeof authClient;

/** Absolute SPA URL (the OAuth callbacks must be absolute, not router paths). */
const appUrl = (path: string): string =>
  typeof window === 'undefined' ? path : new URL(path, window.location.origin).toString();

/**
 * Start a Google sign-in / join. Redirects to Google, then back to the API
 * callback, which:
 *  - mints a session and returns to `/` for an ADMITTED, Google-linked member
 *    (one-click sign-in); or
 *  - for an unknown / still-pending identity, the Admission gate refuses the
 *    session and the callback returns to `/welcome` (errorCallbackURL), where
 *    the person completes the pick-a-username step and waits to be admitted.
 */
export function signInWithGoogle(): Promise<unknown> {
  return authClient.signIn.social({
    provider: 'google',
    callbackURL: appUrl('/'),
    newUserCallbackURL: appUrl('/welcome'),
    errorCallbackURL: appUrl('/welcome'),
  });
}
