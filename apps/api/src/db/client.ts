import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;

/**
 * The transaction handle Drizzle hands to a `db.transaction(async (tx) => …)`
 * callback. Structurally a full query builder, so the Better Auth Drizzle
 * adapter can be bound to it for the duration of a transaction (see the join
 * coordinator, which runs Better Auth's signUp and the crew_member insert in
 * ONE Postgres transaction by binding auth to this tx).
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Either the pooled database or an open transaction — both satisfy the adapter. */
export type DbOrTx = Database | Transaction;

export interface DbHandle {
  db: Database;
  pool: Pool;
}

/** Open a node-postgres pool and bind Drizzle to it (with the full schema). */
export function createDb(connectionString: string): DbHandle {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export { schema };
