// Cloudflare Turnstile server-side verifier (pure domain module).
//
// The ONLY IO is the INJECTED `fetch`: callers pass a fetch implementation (the
// real global fetch in production, a stub in tests). The module performs no DB
// access and opens no real network connection of its own, so it stays
// deterministic and unit-testable. A network failure — the injected fetch
// rejecting, or a body that cannot be read/parsed — NEVER throws; it resolves to
// a failed result so the caller can treat it simply as "not verified".

/** Cloudflare's documented Turnstile siteverify endpoint. */
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Synthetic error code surfaced when the injected fetch rejects or its response
 * body cannot be read (Cloudflare itself never returns this code).
 */
export const NETWORK_ERROR_CODE = 'network-error';

/**
 * Minimal structural shape of the bit of a fetch `Response` we depend on: just
 * `json()`. The real global fetch's `Response` satisfies this, so production
 * code can inject `fetch` directly; tests inject a stub.
 */
export interface TurnstileResponseLike {
  json(): Promise<unknown>;
}

/**
 * Minimal structural shape of the injected fetch. The real global `fetch` is
 * assignable to this, so callers inject it without ceremony. Kept free of any
 * DOM/Node lib types to preserve the module's purity and portability.
 */
export type TurnstileFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<TurnstileResponseLike>;

export interface TurnstileVerifierOptions {
  /** The Turnstile secret key (server-side). */
  secret: string;
  /** Injected fetch implementation — the module's only IO. */
  fetch: TurnstileFetch;
}

export interface TurnstileVerifyResult {
  /** True iff Cloudflare reported `success: true`. */
  ok: boolean;
  /** Cloudflare's `error-codes`, or `[NETWORK_ERROR_CODE]` on a fetch/parse failure. */
  errorCodes: string[];
}

export interface TurnstileVerifier {
  /**
   * Verify a Turnstile token. `ip` (the client's remote IP) is optional and,
   * when supplied, is sent as Cloudflare's `remoteip`. Never throws: a rejected
   * fetch or an unreadable body resolves to
   * `{ ok: false, errorCodes: [NETWORK_ERROR_CODE] }`.
   */
  verify(token: string, ip?: string): Promise<TurnstileVerifyResult>;
}

/** URL-encode a flat field map as an `application/x-www-form-urlencoded` body. */
function encodeForm(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

/** Safely read `success === true` from an unknown siteverify body. */
function readSuccess(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  return (body as Record<string, unknown>)['success'] === true;
}

/** Safely read the string `error-codes` array from an unknown siteverify body. */
function readErrorCodes(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const raw = (body as Record<string, unknown>)['error-codes'];
  if (!Array.isArray(raw)) return [];
  return raw.filter((code): code is string => typeof code === 'string');
}

/**
 * Build a Turnstile verifier bound to a secret and an injected fetch. Compose
 * this rather than calling Cloudflare directly, so the network seam stays
 * injectable and the failure handling lives in one place.
 */
export function createTurnstileVerifier(options: TurnstileVerifierOptions): TurnstileVerifier {
  const { secret, fetch: fetchImpl } = options;

  return {
    async verify(token: string, ip?: string): Promise<TurnstileVerifyResult> {
      const fields: Record<string, string> = { secret, response: token };
      if (ip !== undefined) fields.remoteip = ip;

      try {
        const res = await fetchImpl(SITEVERIFY_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: encodeForm(fields),
        });
        const body = await res.json();
        return { ok: readSuccess(body), errorCodes: readErrorCodes(body) };
      } catch {
        return { ok: false, errorCodes: [NETWORK_ERROR_CODE] };
      }
    },
  };
}
