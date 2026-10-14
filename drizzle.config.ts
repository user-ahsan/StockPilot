import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration (Rule 008 — write once, never hand-edit again).
 * Migrations always run against the direct (non-pooled) connection.
 */
export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!,
  },
});
