'use client';

/** Sticky operational header (Doc 4 §4.5.1): location switcher, sync pill,
 *  theme toggle and the demo-only persona bar. */
import { useQueryClient } from '@tanstack/react-query';
import { Menu, Moon, RotateCw, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { UseAdaptivePollingResult } from '@/hooks/use-adaptive-polling';
import { getPublicEnv } from '@/lib/env';
import { PollingStatusBadge } from './polling-status-badge';

const LOCATIONS = [
  { id: 'ALL', label: 'All Locations' },
  { id: 'a0000000-0000-4000-8000-000000000101', label: 'WH-CENTRAL • Central Warehouse' },
  { id: 'a0000000-0000-4000-8000-000000000102', label: 'STORE-MAIN • Main Showroom' },
  { id: 'a0000000-0000-4000-8000-000000000103', label: 'STORE-DOWNTOWN • Downtown Branch' },
];

const LOCATION_LABELS: Record<string, string> = Object.fromEntries(
  LOCATIONS.map((location) => [location.id, location.label]),
);

const DEMO_PERSONAS: ReadonlyArray<{ role: string; label: string }> = [
  { role: 'OWNER', label: 'Owner' },
  { role: 'MANAGER', label: 'Manager' },
  { role: 'PROCUREMENT_OFFICER', label: 'Procurement' },
  { role: 'WAREHOUSE_CLERK', label: 'Warehouse' },
  { role: 'SALES_ASSOCIATE', label: 'Sales' },
  { role: 'AUDITOR', label: 'Auditor' },
];

export interface TopHeaderProps {
  poll: UseAdaptivePollingResult;
  onOpenSidebar: () => void;
}

export function TopHeader({ poll, onOpenSidebar }: TopHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { resolvedTheme, setTheme } = useTheme();
  const isDemo = getPublicEnv().NEXT_PUBLIC_APP_ENV === 'demo';
  const selectedLocation = searchParams.get('locationId') ?? 'ALL';

  function handleLocationChange(next: string): void {
    const params = new URLSearchParams(searchParams.toString());
    if (next && next !== 'ALL') params.set('locationId', next);
    else params.delete('locationId');
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  async function switchPersona(role: string): Promise<void> {
    try {
      const res = await fetch('/api/v1/auth/demo-switch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        toast.error('Unable to switch demo persona.');
        return;
      }
      toast.success(`Switched to ${role.replace(/_/g, ' ')}`);
      await queryClient.invalidateQueries();
      router.refresh();
    } catch {
      toast.error('Network error while switching persona.');
    }
  }

  return (
    <div className="sticky top-0 z-20">
      <header className="flex h-14 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Open navigation"
            onClick={onOpenSidebar}
          >
            <Menu className="h-5 w-5" />
          </Button>

          <Select value={selectedLocation} items={LOCATION_LABELS} onValueChange={(value) => handleLocationChange(String(value))}>
            <SelectTrigger className="w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCATIONS.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {location.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <PollingStatusBadge
            status={poll.status}
            lastSyncedAt={poll.lastSyncedAt}
            consecutiveFailures={poll.consecutiveFailures}
            onSyncNow={poll.syncNow}
          />
          <Button variant="ghost" size="icon" aria-label="Sync now" onClick={poll.syncNow}>
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          >
            <Sun className="h-4 w-4 dark:hidden" />
            <Moon className="hidden h-4 w-4 dark:block" />
          </Button>
        </div>
      </header>

      {isDemo ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary px-4 py-1.5 text-secondary-foreground">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Demo personas
          </span>
          {DEMO_PERSONAS.map((persona) => (
            <Button
              key={persona.role}
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => void switchPersona(persona.role)}
            >
              {persona.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
