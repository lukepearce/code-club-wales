// Better Auth instance for Code Club Wales.
//
// Closed-access auth: only emails on the ALLOWED_EMAILS allow-list can sign in
// at all. Sign-in is passwordless — a magic link delivered by Resend. There is
// no password and no open self-signup (a deliberate, interim departure from the
// "open signup" design sketched in CONTEXT.md — see the "Interim auth gate"
// note there).
//
// This module is imported by the Vercel functions under /api. It lives outside
// /api on purpose: Vercel only turns files under /api into routes, so shared
// code here is not itself exposed as an endpoint.
//
// Required env (set in the Vercel project + .env.local for `vercel dev`):
//   DATABASE_URL         Neon Postgres connection string (sslmode=require)
//   BETTER_AUTH_SECRET   long random string (openssl rand -base64 32)
//   BETTER_AUTH_URL      site origin, e.g. https://codeclub.wales
//   RESEND_API_KEY       Resend API key (re_...)
//   EMAIL_FROM           verified sender, e.g. "Code Club Wales <login@codeclub.wales>"
//   ALLOWED_EMAILS       comma-separated allow-list, e.g. "a@x.com, b@y.com"

import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { Pool } from '@neondatabase/serverless';
import { Resend } from 'resend';

// --- Allow-list ------------------------------------------------------------
const ALLOWED = new Set(
  (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

function isAllowed(email) {
  return typeof email === 'string' && ALLOWED.has(email.trim().toLowerCase());
}

if (ALLOWED.size === 0) {
  // Fail loud in logs rather than silently letting everyone (or no one) in.
  console.warn('[auth] ALLOWED_EMAILS is empty — no one can sign in until it is set.');
}

// --- Email delivery (Resend) ----------------------------------------------
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const EMAIL_FROM = process.env.EMAIL_FROM || 'Code Club Wales <login@codeclub.wales>';

function magicLinkEmail(url) {
  return `<!doctype html>
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">
  <h1 style="font-size:20px;margin:0 0 12px">Sign in to Code Club Wales</h1>
  <p style="margin:0 0 20px;line-height:1.5">Click the button below to sign in. This link works once and expires in 15 minutes.</p>
  <p style="margin:0 0 24px">
    <a href="${url}" style="display:inline-block;background:#e2725b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">Sign in</a>
  </p>
  <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5">If the button doesn't work, paste this into your browser:<br><span style="word-break:break-all">${url}</span></p>
  <p style="margin:20px 0 0;font-size:13px;color:#6b7280">If you didn't ask for this, you can ignore this email.</p>
</div>`;
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  // @neondatabase/serverless Pool is pg-Pool compatible; Better Auth uses it as
  // its Postgres adapter. Sessions/users live in the standard Better Auth tables.
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  trustedOrigins: [process.env.BETTER_AUTH_URL].filter(Boolean),

  plugins: [
    magicLink({
      expiresIn: 60 * 15, // 15 minutes
      sendMagicLink: async ({ email, url }) => {
        if (!resend) {
          // Local dev without Resend configured: log the link so you can click it.
          console.warn('[auth] RESEND_API_KEY unset — magic link for', email, '\n', url);
          return;
        }
        await resend.emails.send({
          from: EMAIL_FROM,
          to: email,
          subject: 'Your Code Club Wales sign-in link',
          html: magicLinkEmail(url),
        });
      },
    }),
  ],

  // Primary gate: reject any auth request carrying a non-allow-listed email
  // BEFORE a magic link is generated or sent. This is the only entry point that
  // introduces an email, so it covers both first-time sign-up and return logins.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const email = ctx.body?.email;
      if (email && !isAllowed(email)) {
        throw new APIError('FORBIDDEN', {
          message:
            "Sorry — that email isn't on the Code Club allow-list. Ask the organiser to add you.",
        });
      }
    }),
  },

  // Defence in depth: never create a user row for a non-allow-listed email,
  // even if some future flow bypasses the request hook above.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!isAllowed(user.email)) return false; // abort creation
          return { data: user };
        },
      },
    },
  },
});
