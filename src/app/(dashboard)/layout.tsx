'use client';

/** App shell (Doc 4 §4.4): sidebar + top header + scrollable operational canvas.
 *  Client component so it can own the single adaptive-polling subscription that
 *  feeds the header pill and the sidebar badge counts. */
import { Suspense, useState, type ReactNode } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { TopHeader } from '@/components/layout/top-header';
import { useAdaptivePolling } from '@/hooks/use-adaptive-polling';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const poll = useAdaptivePolling({ mode: 'active' });

  const counts = {
    pendingPoApprovalCount: poll.latestSyncData?.pendingPoApprovalCount ?? 0,
    flaggedAdjustmentCount: poll.latestSyncData?.flaggedAdjustmentCount ?? 0,
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Suspense fallback={null}>
        <Sidebar counts={counts} mobileOpen={mobileNavOpen} onMobileOpenChange={setMobileNavOpen} />
      </Suspense>

      <div className="flex min-h-screen flex-col md:pl-64">
        <Suspense fallback={<div className="h-14 border-b border-border" />}>
          <TopHeader poll={poll} onOpenSidebar={() => setMobileNavOpen(true)} />
        </Suspense>

        <main className="flex-1 space-y-6 p-6">
          <Suspense fallback={null}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}
