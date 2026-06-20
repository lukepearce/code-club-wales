// Mounts Better Auth at /api/auth/* (sign-in, magic-link verify, get-session,
// sign-out, ...). Vercel's [...all] catch-all forwards every sub-path here.
import { toNodeHandler } from 'better-auth/node';
import { auth } from '../../lib/auth.js';

// Better Auth reads the raw request body itself, so disable Vercel's parser.
export const config = { api: { bodyParser: false } };

export default toNodeHandler(auth);
