import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { createApp, type App } from '../src/app';
import { createAuth, type Auth } from '../src/auth';
import { createDb, type Database, type DbOrTx } from '../src/db/client';
import { crewMember, user as userTable } from '../src/db/schema';
import { applyMigrations } from '../src/db/migrate';
import { joinCrew, type JoinInput, type JoinResult } from '../src/join';

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
  /** Call the join coordinator directly (bypasses HTTP) for unit-ish setup. */
  join: (input: JoinInput) => Promise<JoinResult>;
  /** Grant Admission to a member by username (direct DB flip, for test setup). */
  admitByUsername: (username: string) => Promise<void>;
  /** Resolve a Better Auth user id from a username (for route params in tests). */
  userIdByUsername: (username: string) => Promise<string>;
  /** Raw connection string, e.g. for opening a second client in a test. */
  connectionString: string;
  /** The started Testcontainers Postgres container. */
  container: StartedPostgreSqlContainer;
  /** Close the pool and stop the container. Call in afterAll. */
  teardown: () => Promise<void>;
}

/** Per-file overrides for the harness. */
export interface TestHarnessOptions {
  /**
   * Usernames bootstrapped as Organisers (the `ORGANISER_USERNAMES` list). A
   * join with a matching username is auto-flagged + auto-admitted. Defaults to
   * empty, so by default no join becomes an Organiser.
   */
  organiserUsernames?: readonly string[];
}

/**
 * Boot an ephemeral Postgres (postgres:16) via Testcontainers, apply the
 * Drizzle migrations, and return a db + a Better Auth instance bound to it + a
 * Hono request helper. Reuse this from every integration test file:
 *
 *   const h = await setupTestApp();
 *   afterAll(() => h.teardown());
 *
 * Boots a fresh container per call, so each test file is fully isolated. Pass
 * `organiserUsernames` to exercise the Organiser bootstrap.
 */
export async function setupTestApp(options: TestHarnessOptions = {}): Promise<TestHarness> {
  const organiserUsernames = options.organiserUsernames ?? [];

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const connectionString = container.getConnectionUri();

  const { db, pool } = createDb(connectionString);
  await applyMigrations(db);

  const makeAuth = (database: DbOrTx): Auth =>
    createAuth({
      db: database,
      secret: 'test-secret-not-for-production',
      baseURL: 'http://localhost:3000',
      trustedOrigins: TEST_TRUSTED_ORIGINS,
      google: { clientId: '', clientSecret: '' },
    });

  const auth = makeAuth(db);

  const join = (input: JoinInput): Promise<JoinResult> =>
    joinCrew({ db, makeAuth, organiserUsernames }, input);

  const app = createApp({ auth, db, trustedOrigins: TEST_TRUSTED_ORIGINS, joinCrew: join });

  const request = (input: string, init?: RequestInit): Promise<Response> =>
    Promise.resolve(app.request(input, init));

  const admitByUsername = async (username: string): Promise<void> => {
    const rows = await db
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.username, username))
      .limit(1);
    const found = rows[0];
    if (!found) {
      throw new Error(`admitByUsername: no user with username "${username}"`);
    }
    await db
      .update(crewMember)
      .set({ admitted_at: new Date() })
      .where(eq(crewMember.user_id, found.id));
  };

  const userIdByUsername = async (username: string): Promise<string> => {
    const rows = await db
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.username, username))
      .limit(1);
    const found = rows[0];
    if (!found) {
      throw new Error(`userIdByUsername: no user with username "${username}"`);
    }
    return found.id;
  };

  const teardown = async (): Promise<void> => {
    await pool.end();
    await container.stop();
  };

  return {
    db,
    auth,
    app,
    request,
    join,
    admitByUsername,
    userIdByUsername,
    connectionString,
    container,
    teardown,
  };
}
