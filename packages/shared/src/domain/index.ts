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
// Each module is re-exported below so apps can import the whole domain surface
// from '@codeclub/shared' or the '@codeclub/shared/domain' subpath. Exported
// names are unique across the modules, so a flat star re-export is unambiguous.
export * from './username-policy.js';
export * from './synthetic-email.js';
export * from './admission-gate.js';
export * from './organiser-policy.js';
export * from './reset-window.js';
export * from './turnstile.js';
