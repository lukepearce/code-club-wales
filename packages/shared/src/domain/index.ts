// Pure domain modules (added in the 'Pure modules' phase). Each module is a
// side-effect-free unit of policy that apps COMPOSE rather than reimplement:
//
//   username-policy.ts   normalize / validate usernames; RESERVED_USERNAMES
//   synthetic-email.ts   synthesise an internal email for username-only joins
//   admission-gate.ts    canMintSession(member) — the sign-in gate
//   organiser-policy.ts  isOrganiser / bootstrap from ORGANISER_USERNAMES
//   reset-window.ts      the Organiser-opened 5-minute reset window
//   turnstile.ts         Cloudflare Turnstile server-side verifier
//
// Re-export each from this barrel as it lands, e.g.
//   export * from './username-policy.js';
export {};
