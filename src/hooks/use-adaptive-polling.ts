'use client';

/**
 * Adaptive delta polling (Rules 101–105).
 *
 * TanStack Query drives the cadence; the poll result drives cache invalidation.
 * State updates happen inside the async `queryFn` (never synchronously in an
 * effect) to stay React 19 Compiler clean.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { getPublicEnv } from '@/lib/env';
import { useNetworkStatus } from './use-network-status';

export interface SyncPollPayload {
  latestLedgerId: number;
  latestPoUpdatedAt: string | null;
  pendingPoApprovalCount: number;
  lowStockCount: number;
  flaggedAdjustmentCount: number;
  hasChanges: boolean;
  serverTime: string;
}

export type PollingStatus = 'live' | 'syncing' | 'degraded' | 'offline';

export interface UseAdaptivePollingOptions {
  mode: 'active' | 'idle';
  locationId?: string | null;
  onDeltaDetected?: (payload: SyncPollPayload) => void;
}

export interface UseAdaptivePollingResult {
  status: PollingStatus;
  consecutiveFailures: number;
  lastSyncedAt: string | null;
  latestSyncData: SyncPollPayload | null;
  syncNow: () => void;
}

const INVALIDATION_KEYS: string[][] = [
  ['overview'],
  ['products'],
  ['purchase-orders'],
  ['sales-orders'],
  ['stock-adjustments'],
  ['inventory-balances'],
];

export function useAdaptivePolling(options: UseAdaptivePollingOptions): UseAdaptivePollingResult {
  const { mode, locationId = null, onDeltaDetected } = options;
  const queryClient = useQueryClient();
  const { isOnline, isTabVisible } = useNetworkStatus();
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [backoffJitter, setBackoffJitter] = useState(0);
  const cursorRef = useRef<number | null>(null);

  const env = getPublicEnv();
  const baseInterval =
    mode === 'active' ? env.NEXT_PUBLIC_POLLING_ACTIVE_MS : env.NEXT_PUBLIC_POLLING_IDLE_MS;

  // Rule 105: exponential backoff with full jitter once failures accumulate.
  // Jitter is produced in the async queryFn (render must stay pure).
  const interval =
    !isOnline || !isTabVisible
      ? false
      : consecutiveFailures === 0
        ? baseInterval
        : Math.min(60_000, baseInterval * 2 ** consecutiveFailures) + backoffJitter;

  const query = useQuery<SyncPollPayload>({
    queryKey: ['sync-poll', locationId ?? 'ALL'],
    enabled: isOnline && isTabVisible,
    refetchInterval: interval,
    refetchIntervalInBackground: false, // Rule 104 — pause when the tab is hidden
    refetchOnWindowFocus: true,
    retry: false, // backoff is handled by the dynamic interval above
    queryFn: async (): Promise<SyncPollPayload> => {
      const params = new URLSearchParams();
      if (locationId) params.set('locationId', locationId);
      if (cursorRef.current !== null) params.set('sinceLedgerId', String(cursorRef.current));

      const res = await fetch(`/api/v1/sync/poll?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) {
        setConsecutiveFailures((count) => count + 1);
        setBackoffJitter(Math.floor(Math.random() * 1000));
        throw new Error(`Sync poll failed with status ${res.status}`);
      }

      const body = (await res.json()) as { data: SyncPollPayload };
      setConsecutiveFailures(0);
      setBackoffJitter(0);
      cursorRef.current = body.data.latestLedgerId;

      if (body.data.hasChanges) {
        for (const key of INVALIDATION_KEYS) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      }
      onDeltaDetected?.(body.data);
      return body.data;
    },
  });

  const status: PollingStatus = !isOnline
    ? 'offline'
    : consecutiveFailures >= 2
      ? 'degraded'
      : query.isFetching
        ? 'syncing'
        : 'live';

  const lastSyncedAt = query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toISOString() : null;

  const { refetch } = query;
  const syncNow = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    status,
    consecutiveFailures,
    lastSyncedAt,
    latestSyncData: query.data ?? null,
    syncNow,
  };
}
