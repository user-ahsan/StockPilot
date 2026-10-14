import 'server-only';

/**
 * Pooled, transactional Drizzle PostgreSQL client (Rule 121 — server-only).
 *
 * A single `pg.Pool` is shared across the monolith. Statement/lock timeouts stop
 * a stalled query from blocking warehouse operations indefinitely (Rule 086).
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const globalForDb = globalThis as unknown as { stockpilotPool?: Pool };

const pool =
  globalForDb.stockpilotPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    statement_timeout: 10_000, // Rule 086
    lock_timeout: 5_000, // Rule 086
  });

if (process.env.NODE_ENV !== 'production') globalForDb.stockpilotPool = pool;

export const db = drizzle(pool, { schema });

export type Database = typeof db;

type TransactionCallback = Parameters<Database['transaction']>[0];
export type DbTransaction = Parameters<TransactionCallback>[0];

/** Run a callback inside a single ACID transaction, passing the scoped `tx`. */
export async function withTransaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return db.transaction((tx) => fn(tx));
}

export { pool };
