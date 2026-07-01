/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Hono API where Better Auth is mounted (no trailing slash). */
  readonly VITE_API_URL: string;
  /** Cloudflare Turnstile site key for the join widget. Falls back to the dev test key. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
