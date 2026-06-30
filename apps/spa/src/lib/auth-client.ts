import { usernameClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// Points at the Hono API; Better Auth appends its /api/auth base path itself.
// Google is added as a social provider in a later slice.
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
  plugins: [usernameClient()],
});

export type AuthClient = typeof authClient;
