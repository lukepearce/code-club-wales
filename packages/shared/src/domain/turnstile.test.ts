import { describe, it, expect, vi } from 'vitest';
import {
  createTurnstileVerifier,
  NETWORK_ERROR_CODE,
  SITEVERIFY_URL,
  type TurnstileFetch,
} from './turnstile.js';

describe('createTurnstileVerifier', () => {
  it('returns ok:true when Cloudflare reports success:true', async () => {
    const fetchStub: TurnstileFetch = async () => ({
      json: async () => ({ success: true }),
    });

    const verifier = createTurnstileVerifier({ secret: 'secret-key', fetch: fetchStub });
    const result = await verifier.verify('a-valid-token', '203.0.113.7');

    expect(result.ok).toBe(true);
    expect(result.errorCodes).toEqual([]);
  });

  it('returns ok:false and surfaces Cloudflare error-codes when success:false', async () => {
    const fetchStub: TurnstileFetch = async () => ({
      json: async () => ({
        success: false,
        'error-codes': ['invalid-input-response', 'timeout-or-duplicate'],
      }),
    });

    const verifier = createTurnstileVerifier({ secret: 'secret-key', fetch: fetchStub });
    const result = await verifier.verify('a-bad-token');

    expect(result.ok).toBe(false);
    expect(result.errorCodes).toEqual(['invalid-input-response', 'timeout-or-duplicate']);
  });

  it('resolves to ok:false (never throws) when the injected fetch rejects', async () => {
    const fetchStub: TurnstileFetch = () => Promise.reject(new Error('network is down'));

    const verifier = createTurnstileVerifier({ secret: 'secret-key', fetch: fetchStub });

    // The await proves it does not throw/reject; the assertion pins the shape.
    const result = await verifier.verify('a-token');

    expect(result.ok).toBe(false);
    expect(result.errorCodes).toEqual([NETWORK_ERROR_CODE]);
  });

  it('POSTs the token (and remoteip when given) to the Cloudflare siteverify endpoint', async () => {
    const fetchSpy = vi.fn<TurnstileFetch>(async () => ({
      json: async () => ({ success: true }),
    }));

    const verifier = createTurnstileVerifier({ secret: 'secret-key', fetch: fetchSpy });
    await verifier.verify('the-token', '198.51.100.42');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      SITEVERIFY_URL,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('response=the-token'),
      }),
    );
    const call = fetchSpy.mock.calls[0];
    expect(call).toBeDefined();
    expect(call?.[1]?.body).toContain('secret=secret-key');
    expect(call?.[1]?.body).toContain('remoteip=198.51.100.42');
  });
});
