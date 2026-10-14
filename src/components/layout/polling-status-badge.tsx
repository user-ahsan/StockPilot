'use client';

/**
 * Live sync / network-health pill (Doc 4 §4.5.1) — pure presentational;
 * the owning header supplies the `useAdaptivePolling` state.
 *
 * NOTE: the installed `@/components/ui/tooltip` is Base UI (no Radix `asChild`),
 * so the trigger wraps its child rather than cloning it.
 */
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { PollingStatus } from '@/hooks/use-adaptive-polling';

export interface PollingStatusBadgeProps {
  status: PollingStatus;
  lastSyncedAt: string | null;
  consecutiveFailures: number;
  onSyncNow?: () => void;
}

function sinceLabel(iso: string | null): string {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

export function PollingStatusBadge({
  status,
  lastSyncedAt,
  consecutiveFailures,
  onSyncNow,
}: PollingStatusBadgeProps) {
  if (status === 'offline') {
    return (
      <Badge variant="destructive" className="gap-1.5">
        <WifiOff className="h-3 w-3" />
        Offline Mode — Mutations Paused
      </Badge>
    );
  }

  if (status === 'degraded') {
    return (
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger className="cursor-default border-0 bg-transparent p-0">
            <Badge variant="secondary" className="gap-1.5">
              <AlertTriangle className="h-3 w-3" />
              Weak Connection • Retrying…
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="font-mono tabular-nums">
            {consecutiveFailures} consecutive failed syncs • last synced {sinceLabel(lastSyncedAt)}
          </TooltipContent>
        </Tooltip>
        {onSyncNow ? (
          <Button variant="ghost" size="sm" onClick={onSyncNow}>
            <RefreshCw className="h-3 w-3" />
            Sync Now
          </Button>
        ) : null}
      </div>
    );
  }

  if (status === 'syncing') {
    return (
      <Badge variant="outline" className="gap-1.5">
        <RefreshCw className="h-3 w-3 animate-spin" />
        Syncing ledger…
      </Badge>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger className="cursor-default border-0 bg-transparent p-0">
        <Badge variant="secondary" className="gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          <span className="font-mono tabular-nums" suppressHydrationWarning>
            Live • Updated {sinceLabel(lastSyncedAt)}
          </span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="font-mono tabular-nums">
        Ledger cursor in sync • last synced {sinceLabel(lastSyncedAt)}
      </TooltipContent>
    </Tooltip>
  );
}
