'use client';

/** Dashboard navigation rail (Doc 4 §4.4–4.5.1, Rule 028). */
import { cn } from 'cn';
import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  FileSpreadsheet,
  LayoutDashboard,
  type LucideIcon,
  PackageSearch,
  Receipt,
  ScrollText,
  ShoppingCart,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

export interface SidebarCounts {
  pendingPoApprovalCount: number;
  flaggedAdjustmentCount: number;
}

export interface SidebarProps {
  counts: SidebarCounts;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: keyof SidebarCounts;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/overview', label: 'Inventory Overview', icon: LayoutDashboard },
  { href: '/catalog', label: 'Product Catalog', icon: Boxes },
  { href: '/catalog/import', label: 'Bulk CSV Import', icon: FileSpreadsheet },
  { href: '/purchase-orders', label: 'Purchase Orders', icon: ClipboardList, badge: 'pendingPoApprovalCount' },
  { href: '/sales-orders', label: 'Sales Orders', icon: ShoppingCart },
  { href: '/adjustments', label: 'Stock Adjustments', icon: AlertTriangle, badge: 'flaggedAdjustmentCount' },
  { href: '/suppliers', label: 'Suppliers', icon: Users },
  { href: '/reports', label: 'Daily Reports', icon: Receipt },
  { href: '/audit-logs', label: 'Audit Trail', icon: ScrollText },
];

function resolveActiveHref(pathname: string): string | undefined {
  return NAV_ITEMS.map((item) => item.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
}

export function Sidebar({ counts, mobileOpen, onMobileOpenChange }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locationId = searchParams.get('locationId');
  const activeHref = resolveActiveHref(pathname);

  const renderNav = () => (
    <nav className="flex flex-col gap-0.5 p-2">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = item.href === activeHref;
        const href = locationId ? `${item.href}?locationId=${encodeURIComponent(locationId)}` : item.href;
        const badgeValue = item.badge ? counts[item.badge] : 0;
        return (
          <Link
            key={item.href}
            href={href}
            onClick={() => onMobileOpenChange(false)}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent/60',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.label}</span>
            {badgeValue > 0 ? (
              <Badge variant="secondary" className="ml-auto font-mono tabular-nums">
                {badgeValue}
              </Badge>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <PackageSearch className="h-5 w-5" />
          <span className="font-semibold tracking-tight">StockPilot</span>
        </div>
        <ScrollArea className="flex-1">{renderNav()}</ScrollArea>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0 text-sidebar-foreground">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <PackageSearch className="h-5 w-5" />
              StockPilot
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="flex-1">{renderNav()}</ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}
