import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestHarness } from './harness';

describe('api smoke', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await setupTestApp();
  });

  afterAll(async () => {
    await harness.teardown();
  });

  it('GET /health returns 200', async () => {
    const res = await harness.request('/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });

  it('does a trivial DB round-trip', async () => {
    const result = await harness.db.execute(sql`select 1 as one`);
    expect(result.rows[0]).toEqual({ one: 1 });
  });

  it('applied the schema (crew_member table exists and is empty)', async () => {
    const result = await harness.db.execute(
      sql`select count(*)::int as count from crew_member`,
    );
    expect(result.rows[0]).toEqual({ count: 0 });
  });
});
