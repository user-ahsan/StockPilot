/**
 * Runtime environment validation (Rules 136–137).
 *
 * Validated at boot with Zod. Any missing/malformed variable aborts startup
 * with a readable checklist instead of a cryptic `undefined` deep in a query.
 *
 * NOTE: intentionally NOT marked `server-only` — `getPublicEnv()` is shared
 * with client components; call `getServerEnv()` on the server only.
 */
import { z } from 'zod';

export const SUPPORTED_APP_ENVS = ['dev', 'demo', 'prod'] as const;
export type AppEnv = (typeof SUPPORTED_APP_ENVS)[number];

const positiveInt = z.coerce.number().int().positive();

/** Variables safe to expose to the browser (`NEXT_PUBLIC_*`). */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_ENV: z.enum(SUPPORTED_APP_ENVS),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_POLLING_ACTIVE_MS: positiveInt,
  NEXT_PUBLIC_POLLING_IDLE_MS: positiveInt,
  NEXT_PUBLIC_REQUEST_TIMEOUT_MS: positiveInt,
});

/** Server-only secrets + operational thresholds (never `NEXT_PUBLIC_*`). */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  DIRECT_DATABASE_URL: z.string().url(),
  SESSION_JWT_SECRET: z.string().min(32, 'SESSION_JWT_SECRET must be at least 32 characters'),
  CRON_SHARED_SECRET: z.string().min(16, 'CRON_SHARED_SECRET must be at least 16 characters'),
  SUPPLIER_WEBHOOK_SIGNING_SECRET: z.string().min(1, 'SUPPLIER_WEBHOOK_SIGNING_SECRET is required'),
  EMAIL_PROVIDER_API_KEY: z.string().min(1, 'EMAIL_PROVIDER_API_KEY is required'),
  DEMO_AUTO_RESET_INTERVAL_HOURS: z.coerce.number().int().min(0),
  SUSPICIOUS_ADJ_VALUE_CENTS: z.coerce.number().int().min(0),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

function formatEnvError(scope: string, error: z.ZodError): string {
  const lines = error.issues.map(
    (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
  return [
    `Invalid ${scope} environment variables:`,
    ...lines,
    '',
    'Fix your .env file(s) before starting StockPilot (see Document 2 §2.7).',
  ].join('\n');
}

let cachedPublicEnv: PublicEnv | null = null;

/** Parse + cache the public (`NEXT_PUBLIC_*`) environment. Throws on failure. */
export function getPublicEnv(): PublicEnv {
  if (cachedPublicEnv) return cachedPublicEnv;
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_POLLING_ACTIVE_MS: process.env.NEXT_PUBLIC_POLLING_ACTIVE_MS,
    NEXT_PUBLIC_POLLING_IDLE_MS: process.env.NEXT_PUBLIC_POLLING_IDLE_MS,
    NEXT_PUBLIC_REQUEST_TIMEOUT_MS: process.env.NEXT_PUBLIC_REQUEST_TIMEOUT_MS,
  });
  if (!parsed.success) throw new Error(formatEnvError('public', parsed.error));
  cachedPublicEnv = parsed.data;
  return cachedPublicEnv;
}

let cachedServerEnv: ServerEnv | null = null;

/** Parse + cache the server environment. Throws on failure or unsafe prod config. */
export function getServerEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;
  const parsed = serverEnvSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,
    SESSION_JWT_SECRET: process.env.SESSION_JWT_SECRET,
    CRON_SHARED_SECRET: process.env.CRON_SHARED_SECRET,
    SUPPLIER_WEBHOOK_SIGNING_SECRET: process.env.SUPPLIER_WEBHOOK_SIGNING_SECRET,
    EMAIL_PROVIDER_API_KEY: process.env.EMAIL_PROVIDER_API_KEY,
    DEMO_AUTO_RESET_INTERVAL_HOURS: process.env.DEMO_AUTO_RESET_INTERVAL_HOURS,
    SUSPICIOUS_ADJ_VALUE_CENTS: process.env.SUSPICIOUS_ADJ_VALUE_CENTS,
  });
  if (!parsed.success) throw new Error(formatEnvError('server', parsed.error));

  // Rule 138: the demo self-reset must be impossible in production.
  if (process.env.NEXT_PUBLIC_APP_ENV === 'prod' && parsed.data.DEMO_AUTO_RESET_INTERVAL_HOURS !== 0) {
    throw new Error(
      "Invalid server environment variables:\n" +
        '  - DEMO_AUTO_RESET_INTERVAL_HOURS: must be 0 when NEXT_PUBLIC_APP_ENV === \'prod\' (Rule 138).',
    );
  }

  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}
