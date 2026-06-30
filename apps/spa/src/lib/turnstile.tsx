// Cloudflare Turnstile widget for the join form (the ONLY place the SPA uses a
// challenge — sign-in is edge rate-limited, Google self-gates). Loads
// Cloudflare's script once and renders the widget explicitly so its token flows
// back through `onToken`; the join request carries that token, which the API
// verifies server-side before creating any account.

import { useEffect, useRef } from 'react';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

// Cloudflare's DOCUMENTED dev TEST site key: always passes and renders locally
// (paired with the API's test secret). HUMAN HANDOFF: set VITE_TURNSTILE_SITE_KEY
// to the real site key in production.
const DEV_TEST_SITE_KEY = '1x00000000000000000000AA';

export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || DEV_TEST_SITE_KEY;

interface RenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
}

interface TurnstileApi {
  render: (el: HTMLElement, options: RenderOptions) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

/** Inject the Turnstile script once; resolve when `window.turnstile` is ready. */
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src^="${SCRIPT_SRC}"]`);
    const onLoad = (): void => resolve();
    const onError = (): void => reject(new Error('Failed to load the Turnstile script.'));
    if (existing) {
      if (window.turnstile) {
        resolve();
        return;
      }
      existing.addEventListener('load', onLoad);
      existing.addEventListener('error', onError);
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface TurnstileProps {
  /** Called with a fresh token each time the challenge is solved. */
  onToken: (token: string) => void;
  /** Called when the token errors or expires; clear any held token here. */
  onError?: () => void;
}

/**
 * Renders a single Turnstile widget. Keeps the latest callbacks in refs so the
 * widget mounts once (not re-rendered on every parent state change), and is safe
 * under React StrictMode's mount/unmount/mount probe.
 */
export function Turnstile({ onToken, onError }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const onErrorRef = useRef(onError);
  onTokenRef.current = onToken;
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        if (widgetId.current) return; // already rendered
        widgetId.current = window.turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token) => onTokenRef.current(token),
          'error-callback': () => onErrorRef.current?.(),
          'expired-callback': () => onErrorRef.current?.(),
        });
      })
      .catch(() => onErrorRef.current?.());

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, []);

  return <div ref={containerRef} className="turnstile" />;
}
