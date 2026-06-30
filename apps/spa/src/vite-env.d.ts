/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Hono API where Better Auth is mounted (no trailing slash). */
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
