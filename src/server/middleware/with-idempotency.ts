import 'server-only';

/**
 * Backend idempotency middleware (Rules 091–096, Doc 2 §2.5, Doc 3 §3.4-C).
 *
 * Three exact states: NEW key → run; COMPLETED → replay or 422 on hash mismatch;
 * IN_PROGRESS (lock live) → 409 + Retry-After. Storage is pluggable so tests can
 * exercise concurrency/replay deterministically without PostgreSQL.
 *
 * NOTE: runtime imports are relative (not `@/`) so the Vitest suite can import
 * this module directly without a path-alias config.
 */
import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '../db';
import { idempotencyKeys } from '../db/schema';
import type { AuthedRouteHandler } from './with-auth';

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
export const IDEMPOTENCY_LOCK_MS = 30_000;

export type IdempotencyStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface IdempotencyRecord {
  organizationId: string;
  key: string;
  memberId: string;
  method: string;
  pathname: string;
  requestHash: string;
  status: IdempotencyStatus;
  responseStatus: number | null;
  responseBody: unknown;
  lockedUntil: Date;
}

export interface IdempotencyStorageAdapter {
  tryAcquire(
    record: IdempotencyRecord,
    now: Date,
  ): Promise<{ acquired: boolean; existing?: IdempotencyRecord }>;
  complete(record: IdempotencyRecord, responseStatus: number, responseBody: unknown): Promise<void>;
  fail(record: IdempotencyRecord): Promise<void>;
}

// ── In-memory adapter (tests / integration) ───────────────────────────
export class InMemoryIdempotencyStorageAdapter implements IdempotencyStorageAdapter {
  private readonly store = new Map<string, IdempotencyRecord>();

  private idOf(record: IdempotencyRecord): string {
    return `${record.organizationId}:${record.key}`;
  }

  async tryAcquire(
    record: IdempotencyRecord,
    now: Date,
  ): Promise<{ acquired: boolean; existing?: IdempotencyRecord }> {
    const id = this.idOf(record);
    const existing = this.store.get(id);
    if (!existing) {
      this.store.set(id, { ...record });
      return { acquired: true };
    }
    const expired = existing.lockedUntil.getTime() <= now.getTime();
    if (existing.status === 'FAILED' || (existing.status === 'IN_PROGRESS' && expired)) {
      this.store.set(id, { ...record });
      return { acquired: true };
    }
    return { acquired: false, existing };
  }

  async complete(record: IdempotencyRecord, responseStatus: number, responseBody: unknown): Promise<void> {
    const existing = this.store.get(this.idOf(record));
    if (existing) {
      existing.status = 'COMPLETED';
      existing.responseStatus = responseStatus;
      existing.responseBody = responseBody;
    }
  }

  async fail(record: IdempotencyRecord): Promise<void> {
    const existing = this.store.get(this.idOf(record));
    if (existing) existing.status = 'FAILED';
  }
}

// ── Postgres adapter (production) ─────────────────────────────────────
export class PostgresIdempotencyStorageAdapter implements IdempotencyStorageAdapter {
  async tryAcquire(
    record: IdempotencyRecord,
    now: Date,
  ): Promise<{ acquired: boolean; existing?: IdempotencyRecord }> {
    const inserted = await db
      .insert(idempotencyKeys)
      .values({
        organizationId: record.organizationId,
        idempotencyKey: record.key,
        actorMemberId: record.memberId,
        requestMethod: record.method,
        requestPath: record.pathname,
        requestHash: record.requestHash,
        status: 'IN_PROGRESS',
        lockedUntil: record.lockedUntil,
      })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.idempotencyKey });
    if (inserted.length > 0) return { acquired: true };

    const [row] = await db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.organizationId, record.organizationId),
          eq(idempotencyKeys.idempotencyKey, record.key),
        ),
      )
      .limit(1);
    if (!row) return { acquired: true };

    const expired = row.lockedUntil.getTime() <= now.getTime();
    if (row.status === 'FAILED' || (row.status === 'IN_PROGRESS' && expired)) {
      await db
        .update(idempotencyKeys)
        .set({ status: 'IN_PROGRESS', requestHash: record.requestHash, lockedUntil: record.lockedUntil })
        .where(
          and(
            eq(idempotencyKeys.organizationId, record.organizationId),
            eq(idempotencyKeys.idempotencyKey, record.key),
          ),
        );
      return { acquired: true };
    }

    return {
      acquired: false,
      existing: {
        organizationId: row.organizationId,
        key: row.idempotencyKey,
        memberId: row.actorMemberId,
        method: row.requestMethod,
        pathname: row.requestPath,
        requestHash: row.requestHash,
        status: row.status as IdempotencyStatus,
        responseStatus: row.responseStatus,
        responseBody: row.responseBody,
        lockedUntil: row.lockedUntil,
      },
    };
  }

  private async setStatus(
    record: IdempotencyRecord,
    values: Partial<typeof idempotencyKeys.$inferInsert>,
  ): Promise<void> {
    await db
      .update(idempotencyKeys)
      .set(values)
      .where(
        and(
          eq(idempotencyKeys.organizationId, record.organizationId),
          eq(idempotencyKeys.idempotencyKey, record.key),
        ),
      );
  }

  complete(record: IdempotencyRecord, responseStatus: number, responseBody: unknown): Promise<void> {
    return this.setStatus(record, { status: 'COMPLETED', responseStatus, responseBody });
  }

  fail(record: IdempotencyRecord): Promise<void> {
    return this.setStatus(record, { status: 'FAILED' });
  }
}

// ── Engine (framework-agnostic, unit-testable) ────────────────────────
export interface IdempotencyOutcome {
  status: number;
  body: unknown;
  replayed: boolean;
  retryAfter?: number;
}

export interface RunIdempotentParams {
  adapter: IdempotencyStorageAdapter;
  organizationId: string;
  memberId: string;
  method: string;
  pathname: string;
  idempotencyKey: string | null;
  rawBody: string;
  correlationId?: string;
  now?: () => Date;
  execute: () => Promise<{ status: number; body: unknown }>;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function errorBody(code: string, message: string, correlationId?: string): unknown {
  return { error: { code, message, details: null, correlationId: correlationId ?? null } };
}

export async function runIdempotent(params: RunIdempotentParams): Promise<IdempotencyOutcome> {
  const now = params.now ?? (() => new Date());
  const key = params.idempotencyKey;

  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return {
      status: 400,
      replayed: false,
      body: errorBody(
        'IDEMPOTENCY_KEY_REQUIRED',
        'A valid Idempotency-Key header (16–128 chars, [A-Za-z0-9_-]) is required for state-mutating requests.',
        params.correlationId,
      ),
    };
  }

  const requestHash = await sha256Hex(
    [params.organizationId, params.memberId, params.method, params.pathname, params.rawBody].join(':'),
  );
  const record: IdempotencyRecord = {
    organizationId: params.organizationId,
    key,
    memberId: params.memberId,
    method: params.method,
    pathname: params.pathname,
    requestHash,
    status: 'IN_PROGRESS',
    responseStatus: null,
    responseBody: null,
    lockedUntil: new Date(now().getTime() + IDEMPOTENCY_LOCK_MS),
  };

  const acquisition = await params.adapter.tryAcquire(record, now());

  if (!acquisition.acquired && acquisition.existing) {
    const existing = acquisition.existing;
    if (existing.requestHash !== requestHash) {
      return {
        status: 422,
        replayed: false,
        body: errorBody(
          'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
          'This Idempotency-Key was already used with a different request payload.',
          params.correlationId,
        ),
      };
    }
    if (existing.status === 'COMPLETED') {
      return {
        status: existing.responseStatus ?? 200,
        replayed: true,
        body: existing.responseBody,
      };
    }
    return {
      status: 409,
      replayed: false,
      retryAfter: 2,
      body: errorBody(
        'IDEMPOTENCY_REQUEST_IN_PROGRESS',
        'A request with this Idempotency-Key is already in progress. Retry shortly.',
        params.correlationId,
      ),
    };
  }

  let executed: { status: number; body: unknown };
  try {
    executed = await params.execute();
  } catch (error) {
    await params.adapter.fail(record);
    throw error;
  }

  if (executed.status >= 500) {
    await params.adapter.fail(record); // unexpected — let the client retry
  } else {
    await params.adapter.complete(record, executed.status, executed.body);
  }
  return { status: executed.status, replayed: false, body: executed.body };
}

// ── Next.js glue ──────────────────────────────────────────────────────
export interface IdempotencyOptions {
  adapter?: IdempotencyStorageAdapter;
  now?: () => Date;
}

async function readRawBody(req: NextRequest): Promise<string> {
  if (req.method === 'GET' || req.method === 'HEAD') return '';
  try {
    return await req.clone().text();
  } catch {
    return '';
  }
}

export function withIdempotency(
  handler: AuthedRouteHandler,
  options: IdempotencyOptions = {},
): AuthedRouteHandler {
  return async (req, ctx) => {
    const adapter = options.adapter ?? new PostgresIdempotencyStorageAdapter();
    const rawBody = await readRawBody(req);
    const captured: { original: NextResponse | null } = { original: null };

    const outcome = await runIdempotent({
      adapter,
      organizationId: ctx.organizationId,
      memberId: ctx.memberId,
      method: req.method,
      pathname: req.nextUrl.pathname,
      idempotencyKey: req.headers.get('idempotency-key'),
      rawBody,
      correlationId: ctx.correlationId,
      now: options.now,
      execute: async () => {
        const response = await handler(req, ctx);
        captured.original = response;
        const body = await response
          .clone()
          .json()
          .catch(() => null);
        return { status: response.status, body };
      },
    });

    if (outcome.replayed) {
      const replayed = NextResponse.json(outcome.body, { status: outcome.status });
      replayed.headers.set('X-Idempotency-Replayed', 'true');
      return replayed;
    }

    if (captured.original) {
      if (outcome.retryAfter) {
        captured.original.headers.set('Retry-After', String(outcome.retryAfter));
      }
      return captured.original;
    }

    const response = NextResponse.json(outcome.body, { status: outcome.status });
    if (outcome.retryAfter) response.headers.set('Retry-After', String(outcome.retryAfter));
    return response;
  };
}
