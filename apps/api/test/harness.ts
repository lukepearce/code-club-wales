import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { createApp, type App } from '../src/app';
import { createAuth, type Auth } from '../src/auth';
import { createDb, type Database } from '../src/db/client';
import { applyMigrations } from '../src/db/migrate';

// Pinned to Railway's Postgres add-on major.
const POSTGRES_IMAGE = 'postgres:16';

const TEST_TRUSTED_ORIGINS = ['http://localhost:5173'];

export interface TestHarness {
  /** Drizzle db bound to the ephemeral container (full schema). */
  db: Database;
  /** Better Auth instance bound to that db. */
  auth: Auth;
  /** The mounted Hono app. */
  app: App;
  /** Fire a request straight at the Hono app (no socket). */
  request: (input: string, init?: RequestInit) => Promise<Response>;
  /** Raw connection string, e.g. for opening a second client in a test. */
  connectionString: string;
  /** The started Testcontainers Postgres container. */
  container: StartedPostgreSqlContainer;
  /** Close the pool and stop the container. Call in afterAll. */
  teardown: () => Promise<void>;
}

/**
 * Boot an ephemeral Postgres (postgres:16) via Testcontainers, apply the
 * Drizzle migrations, and return a db + a Better Auth instance bound to it + a
 * Hono request helper. Reuse this from every integration test file:
 *
 *   const h = await setupTestApp();
 *   afterAll(() => h.teardown());
 *
 * Boots a fresh container per call, so each test file is fully isolated.
 */
export async function setupTestApp(): Promise<TestHarness> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const connectionString = container.getConnectionUri();

  const { db, pool } = createDb(connectionString);
  await applyMigrations(db);

  const auth = createAuth({
    db,
    secret: 'test-secret-not-for-production',
    baseURL: 'http://localhost:3000',
    trustedOrigins: TEST_TRUSTED_ORIGINS,
    google: { clientId: '', clientSecret: '' },
  });

  const app = createApp({ auth, trustedOrigins: TEST_TRUSTED_ORIGINS });

  const request = (input: string, init?: RequestInit): Promise<Response> =>
    Promise.resolve(app.request(input, init));

  const teardown = async (): Promise<void> => {
    await pool.end();
    await container.stop();
  };

  return { db, auth, app, request, connectionString, container, teardown };
}
