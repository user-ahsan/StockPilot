'use client';

/**
 * Idempotent mutation hook (Rules 097–099).
 *
 * Holds a stable Idempotency-Key per submit intent, reusing it across network
 * failures/timeouts, and rotating it only on success or a 400/422 payload error.
 */
import { useMutation, type UseMutationOptions, type UseMutationResult } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { generateIdempotencyKey } from '@/lib/idempotency-client';

export type IdempotentMutationFn<TData, TVariables> = (
  variables: TVariables,
  idempotencyKey: string,
) => Promise<TData>;

export type UseIdempotentMutationResult<TData, TError, TVariables> = UseMutationResult<
  TData,
  TError,
  TVariables,
  unknown
> & {
  /** Mint a fresh key for the next logical submission (Rule 098). */
  resetIdempotencyKey: () => void;
};

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

/** Rotate the key only when the payload must change before retrying (Rule 098). */
function requiresPayloadChange(error: unknown): boolean {
  const status = statusOf(error);
  return status === 400 || status === 422;
}

type MutationOptions<TData, TError, TVariables> = UseMutationOptions<TData, TError, TVariables, unknown>;

export function useIdempotentMutation<TData = unknown, TError = Error, TVariables = void>(
  mutationFn: IdempotentMutationFn<TData, TVariables>,
  options: Omit<MutationOptions<TData, TError, TVariables>, 'mutationFn'> = {},
): UseIdempotentMutationResult<TData, TError, TVariables> {
  const keyRef = useRef<string>(generateIdempotencyKey());

  const handleSuccess: NonNullable<MutationOptions<TData, TError, TVariables>['onSuccess']> = (
    ...args
  ) => {
    keyRef.current = generateIdempotencyKey();
    return options.onSuccess?.(...args);
  };

  const handleError: NonNullable<MutationOptions<TData, TError, TVariables>['onError']> = (
    ...args
  ) => {
    if (requiresPayloadChange(args[0])) keyRef.current = generateIdempotencyKey();
    return options.onError?.(...args);
  };

  const mutation = useMutation<TData, TError, TVariables, unknown>({
    ...options,
    mutationFn: (variables) => mutationFn(variables, keyRef.current),
    onSuccess: handleSuccess,
    onError: handleError,
  });

  const resetIdempotencyKey = useCallback(() => {
    keyRef.current = generateIdempotencyKey();
  }, []);

  return { ...mutation, resetIdempotencyKey };
}
