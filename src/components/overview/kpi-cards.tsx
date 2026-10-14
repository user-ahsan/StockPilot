'use client';

/** 4 KPI metric cards (Doc 4 §4.5.2, Doc 1 Module A). */
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/money';

export interface KpiSummary {
  totalActiveSkus: number;
  discontinuedSkus: number;
  totalValuationCents: number;
  currency: string;
  valuationChangeBps: number;
  lowStockCount: number;
  outOfStockCount: number;
  pendingPoCount: number;
  pendingPoValueCents: number;
}

export interface KpiCardsProps {
  kpis: KpiSummary;
  locationId: string | null;
}

export function KpiCards({ kpis, locationId }: KpiCardsProps) {
  const catalogHref = locationId
    ? `/catalog?reorderStatus=LOW_STOCK&locationId=${encodeURIComponent(locationId)}`
    : '/catalog?reorderStatus=LOW_STOCK';
  const poHref = locationId
    ? `/purchase-orders?locationId=${encodeURIComponent(locationId)}`
    : '/purchase-orders';
  const attentionCount = kpis.lowStockCount + kpis.outOfStockCount;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Total Active SKUs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="font-mono text-2xl font-bold tabular-nums">{kpis.totalActiveSkus}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">{kpis.discontinuedSkus}</span> discontinued
          </p>
        </CardContent>
      </Card>

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Total Stock Valuation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="font-mono text-2xl font-bold tabular-nums">
            {formatMoney(kpis.totalValuationCents, kpis.currency)}
          </p>
          <Badge variant="secondary" className="font-mono tabular-nums">
            on_hand × unit_cost
          </Badge>
        </CardContent>
      </Card>

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Low &amp; Out-of-Stock Items
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <Link href={catalogHref} className="inline-flex items-center gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums">{kpis.lowStockCount}</span>
            {attentionCount > 0 ? (
              <Badge variant="destructive" className="font-mono tabular-nums">
                {kpis.outOfStockCount} out of stock
              </Badge>
            ) : (
              <Badge variant="secondary">all healthy</Badge>
            )}
          </Link>
          <p className="text-xs text-muted-foreground">View flagged catalog rows →</p>
        </CardContent>
      </Card>

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Pending Purchase Orders
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <Link href={poHref} className="inline-flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums">{kpis.pendingPoCount}</span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {formatMoney(kpis.pendingPoValueCents, kpis.currency)}
            </span>
          </Link>
          <p className="text-xs text-muted-foreground">Submitted • approved • partially received</p>
        </CardContent>
      </Card>
    </div>
  );
}
