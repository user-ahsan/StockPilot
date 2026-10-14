/**
 * Fetch wrapper (Rules 100–101): AbortController timeout, automatic
 * Idempotency-Key injection for mutations, and `{ data, meta }` / `{ error }`
 * envelope parsing with `X-Idempotency-Replayed` detection.
 */
import { getPublicEnv } from './env';
import { generateIdempotencyKey } from './idempotency-client';

export interface ApiSuccessEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
    correlationId?: string | null;
  };
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T; meta: Record<string, unknown>; replayed: boolean }
  | { ok: false; status: number; error: ApiErrorEnvelope['error'] };

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
}

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function apiClient<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiResult<T>> {
  const { body, idempotencyKey, timeoutMs, ...init } = options;
  const method = (init.method ?? (body !== undefined ? 'POST' : 'GET')).toUpperCase();
  const publicEnv = getPublicEnv();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? publicEnv.NEXT_PUBLIC_REQUEST_TIMEOUT_MS);

  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  let bodyText: string | undefined;
  if (body !== undefined) {
    headers.set('content-type', 'application/json');
    bodyText = JSON.stringify(body);
  }
  if (MUTATION_METHODS.has(method)) {
    headers.set('idempotency-key', idempotencyKey ?? generateIdempotencyKey());
  }

  try {
    const response = await fetch(new URL(path, publicEnv.NEXT_PUBLIC_APP_URL), {
      ...init,
      method,
      headers,
      body: bodyText,
      credentials: 'include',
      signal: controller.signal,
    });

    const replayed = response.headers.get('x-idempotency-replayed') === 'true';
    const payload = (await response.json().catch(() => null)) as
      | ApiSuccessEnvelope<T>
      | ApiErrorEnvelope
      | null;

    if (!response.ok) {
      const failure = payload as ApiErrorEnvelope | null;
      return {
        ok: false,
        status: response.status,
        error: failure?.error ?? {
          code: 'UNKNOWN_ERROR',
          message: `Request failed with status ${response.status}.`,
        },
      };
    }

    const success = payload as ApiSuccessEnvelope<T> | null;
    return {
      ok: true,
      status: response.status,
      data: success?.data as T,
      meta: success?.meta ?? {},
      replayed,
    };
  } finally {
    clearTimeout(timer);
  }
}
