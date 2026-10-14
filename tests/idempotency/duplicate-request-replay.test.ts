import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryIdempotencyStorageAdapter,
  withIdempotency,
} from '../../src/server/middleware/with-idempotency';
import type { AuthenticatedContext } from '../../src/server/middleware/with-auth';

// `server-only` throws outside a React Server bundle — neutralise it for tests.
vi.mock('server-only', () => ({}));

const AUTH: AuthenticatedContext = {
  memberId: 'm1',
  organizationId: 'o1',
  email: 'owner@nexushardware.test',
  fullName: 'Olivia Owner',
  role: 'OWNER',
  assignedLocationId: null,
  correlationId: 'corr-test-1',
};

function makeRequest(key: string | null, body: unknown): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (key) headers.set('idempotency-key', key);
  return new NextRequest('http://localhost/api/v1/test', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function makeHandler() {
  return vi.fn(async () => NextResponse.json({ data: { ok: true } }, { status: 200 }));
}

describe('withIdempotency middleware (Rules 091–096)', () => {
  it('rejects a missing Idempotency-Key with 400 and never runs the handler', async () => {
    const handler = makeHandler();
    const wrapped = withIdempotency(handler, { adapter: new InMemoryIdempotencyStorageAdapter() });

    const res = await wrapped(makeRequest(null, { a: 1 }), AUTH);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(handler).not.toHaveBeenCalled();
  });

  it('executes the handler exactly once and replays 4 retries', async () => {
    const handler = makeHandler();
    const wrapped = withIdempotency(handler, { adapter: new InMemoryIdempotencyStorageAdapter() });
    const key = 'sp_idem_0123456789abcdef';

    const responses: NextResponse[] = [];
    for (let i = 0; i < 5; i++) {
      responses.push(await wrapped(makeRequest(key, { a: 1 }), AUTH));
    }

    expect(handler).toHaveBeenCalledTimes(1);
    expect(responses[0].headers.get('x-idempotency-replayed')).toBeNull();
    for (const res of responses.slice(1)) {
      expect(res.status).toBe(200);
      expect(res.headers.get('x-idempotency-replayed')).toBe('true');
    }
    const bodies = await Promise.all(responses.map((res) => res.json()));
    for (const body of bodies) expect(body).toEqual({ data: { ok: true } });
  });

  it('returns 422 when the same key is reused with a different payload', async () => {
    const handler = makeHandler();
    const wrapped = withIdempotency(handler, { adapter: new InMemoryIdempotencyStorageAdapter() });
    const key = 'sp_idem_mismatch_000001';

    await wrapped(makeRequest(key, { a: 1 }), AUTH);
    const res = await wrapped(makeRequest(key, { a: 2 }), AUTH);

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('returns 409 + Retry-After while the first request is still IN_PROGRESS', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = vi.fn(async () => {
      await gate;
      return NextResponse.json({ data: { slow: true } }, { status: 200 });
    });
    const wrapped = withIdempotency(handler, { adapter: new InMemoryIdempotencyStorageAdapter() });
    const key = 'sp_idem_inprogress_0001';

    const first = wrapped(makeRequest(key, { v: 1 }), AUTH);
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the first acquire the lock

    const second = await wrapped(makeRequest(key, { v: 1 }), AUTH);
    expect(second.status).toBe(409);
    expect(second.headers.get('retry-after')).toBe('2');
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe('IDEMPOTENCY_REQUEST_IN_PROGRESS');

    release();
    const firstRes = await first;
    expect(firstRes.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('runs the handler once across 5 truly concurrent identical requests', async () => {
    const handler = makeHandler();
    const wrapped = withIdempotency(handler, { adapter: new InMemoryIdempotencyStorageAdapter() });
    const key = 'sp_idem_concurrent_000001';

    const results = await Promise.all(
      Array.from({ length: 5 }, () => wrapped(makeRequest(key, { c: 1 }), AUTH)),
    );

    // Exactly one handler run; the rest are replays (200 + X-Idempotency-Replayed)
    // or, if they lose the microtask race, 409 in-progress — never a 5xx.
    const replayed = results.filter((res) => res.headers.get('x-idempotency-replayed') === 'true');
    const originals = results.filter((res) => res.headers.get('x-idempotency-replayed') !== 'true');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(originals).toHaveLength(1);
    expect(replayed).toHaveLength(4);
    expect(results.every((res) => res.status === 200 || res.status === 409)).toBe(true);
  });
});
