'use client';

/** Daily Sales, COGS & Inventory Valuation Reports (Doc 1 Module F). */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient } from '@/lib/api-client';
import { escapeCsvCellForExport } from '@/lib/validators/csv.schema';
import { formatMoney } from '@/lib/money';

interface OutboxEvent {
  id: string;
  eventType: string;
  status: string;
  dedupKey: string;
}

interface DailyReport {
  reportDate: string;
  generatedAt: string;
  currency: string;
  salesMetrics: { fulfilledOrdersCount: number; confirmedReservedOrdersCount: number; grossRevenueCents: number; cogsCents: number; grossProfitCents: number; grossMarginBps: number; totalUnitsSold: number };
  inventoryMetrics: { totalActiveSkus: number; totalOnHandUnits: number; totalAvailableUnits: number; totalEndingValuationCents: number; lowStockSkuCount: number; outOfStockSkuCount: number };
  procurementMetrics: { openPoCount: number; pendingApprovalPoCount: number; autoDraftedPoCount: number; committedPoValueCents: number; unitsReceivedToday: number };
  securityAndShrinkageMetrics: { totalAdjustmentsCount: number; negativeShrinkageUnits: number; netShrinkageImpactCents: number; suspiciousFlaggedCount: number; pendingReviewCount: number };
  locationBreakdown: Array<{ locationId: string; locationCode: string; locationName: string; skuCount: number; onHandUnits: number; reservedUnits: number; availableUnits: number; valuationCents: number; lowStockCount: number }>;
  topMovingSkus: Array<{ productVariantId: string; sku: string; variantName: string; category: string; inboundUnits: number; outboundUnits: number; adjustmentUnits: number; onHandQty: number; availableQty: number; valuationCents: number }>;
}

const LOCATIONS = [
  { id: 'ALL', label: 'All Locations' },
  { id: 'a0000000-0000-4000-8000-000000000101', label: 'WH-CENTRAL • Central Warehouse' },
  { id: 'a0000000-0000-4000-8000-000000000102', label: 'STORE-MAIN • Main Showroom' },
  { id: 'a0000000-0000-4000-8000-000000000103', label: 'STORE-DOWNTOWN • Downtown Branch' },
];
const LOCATION_LABELS: Record<string, string> = Object.fromEntries(LOCATIONS.map((l) => [l.id, l.label]));

export default function ReportsPage() {
  const queryClient = useQueryClient();
  const [locationId, setLocationId] = useState('ALL');
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<DailyReport>({
    queryKey: ['daily-report', locationId],
    queryFn: async (): Promise<DailyReport> => {
      const params = new URLSearchParams();
      if (locationId !== 'ALL') params.set('locationId', locationId);
      const res = await apiClient<DailyReport>(`/api/internal/cron/daily-report?${params.toString()}`);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const { data: outbox } = useQuery<{ events: OutboxEvent[]; pendingCount: number }>({
    queryKey: ['outbox-events'],
    queryFn: async () => {
      const res = await apiClient<{ events: OutboxEvent[]; pendingCount: number }>('/api/internal/cron/outbox-processor');
      return res.ok ? res.data : { events: [], pendingCount: 0 };
    },
  });

  async function runOutbox(): Promise<void> {
    setBusy(true);
    try {
      const res = await apiClient<{ processedCount: number; autoDraftedPoIds: string[]; alertsSent: number; skippedCount: number; failedCount: number }>(
        '/api/internal/cron/outbox-processor',
        { method: 'POST' },
      );
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success(
        `Outbox: ${res.data.processedCount} processed · ${res.data.autoDraftedPoIds.length} auto-POs · ${res.data.alertsSent} alerts · ${res.data.skippedCount} skipped`,
      );
      await queryClient.invalidateQueries();
      void refetch();
    } finally {
      setBusy(false);
    }
  }

  function exportCsv(): void {
    if (!data) return;
    const header = ['location_code', 'location_name', 'sku_count', 'on_hand', 'reserved', 'available', 'valuation_usd', 'low_stock'];
    const rows = data.locationBreakdown.map((row) =>
      [row.locationCode, row.locationName, row.skuCount, row.onHandUnits, row.reservedUnits, row.availableUnits, (row.valuationCents / 100).toFixed(2), row.lowStockCount]
        .map((cell) => escapeCsvCellForExport(cell))
        .join(','),
    );
    const csv = [header.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `stockpilot-valuation-${data.reportDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Daily Reports</h1>
          <p className="text-sm text-muted-foreground">Sales, COGS, valuation, procurement &amp; shrinkage snapshot.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={locationId} items={LOCATION_LABELS} onValueChange={(value) => setLocationId(String(value))}>
            <SelectTrigger className="w-[220px]">
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
          <Button variant="secondary" onClick={() => void refetch()}>Generate Fresh Daily Report Snapshot</Button>
          <Button disabled={busy} onClick={() => void runOutbox()}>{busy ? 'Running…' : 'Run Automation Outbox Now'}</Button>
          <Button variant="outline" onClick={exportCsv}>Export Valuation Report CSV</Button>
        </div>
      </div>

      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not generate the report</AlertTitle>
          <AlertDescription>The report service is temporarily unavailable.</AlertDescription>
        </Alert>
      ) : null}

      {isLoading || !data ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[
              { label: 'Gross Revenue', value: formatMoney(data.salesMetrics.grossRevenueCents, data.currency) },
              { label: 'COGS (snapshot cost)', value: formatMoney(data.salesMetrics.cogsCents, data.currency) },
              { label: 'Gross Profit', value: `${formatMoney(data.salesMetrics.grossProfitCents, data.currency)} · ${(data.salesMetrics.grossMarginBps / 100).toFixed(1)}%` },
              { label: 'Ending Inventory Valuation', value: formatMoney(data.inventoryMetrics.totalEndingValuationCents, data.currency) },
              { label: 'Committed PO Pipeline', value: formatMoney(data.procurementMetrics.committedPoValueCents, data.currency) },
              { label: 'Net Shrinkage Impact', value: formatMoney(data.securityAndShrinkageMetrics.netShrinkageImpactCents, data.currency) },
            ].map((kpi) => (
              <Card key={kpi.label} className="border-border bg-card text-card-foreground">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">{kpi.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-mono text-lg font-bold tabular-nums">{kpi.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="border-border bg-card text-card-foreground">
            <CardHeader className="pb-2"><CardTitle className="text-base font-semibold text-card-foreground">Per-location valuation &amp; health</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Location</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">SKUs</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">On Hand</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Reserved</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Available</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Valuation</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Low Stock</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.locationBreakdown.map((row) => (
                    <TableRow key={row.locationId} className="h-9">
                      <TableCell className="font-mono text-xs tabular-nums">{row.locationCode}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{row.skuCount}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{row.onHandUnits}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{row.reservedUnits}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{row.availableUnits}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{formatMoney(row.valuationCents, data.currency)}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{row.lowStockCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="border-border bg-card text-card-foreground">
            <CardHeader className="pb-2"><CardTitle className="text-base font-semibold text-card-foreground">Top moving SKUs</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">SKU</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Category</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Inbound</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Outbound</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Adjust</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Available</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Valuation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topMovingSkus.map((row) => (
                    <TableRow key={row.productVariantId} className="h-9">
                      <TableCell className="font-mono text-xs tabular-nums">{row.sku}</TableCell>
                      <TableCell className="text-xs">{row.category}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">+{row.inboundUnits}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">-{row.outboundUnits}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{row.adjustmentUnits}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{row.availableQty}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{formatMoney(row.valuationCents, data.currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="border-border bg-card text-card-foreground">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-card-foreground">
                Automation outbox queue ({outbox?.pendingCount ?? 0} pending)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Event</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Status</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Dedup key</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(outbox?.events ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="py-6 text-center text-xs text-muted-foreground">No outbox events.</TableCell></TableRow>
                  ) : (
                    (outbox?.events ?? []).map((event) => (
                      <TableRow key={event.id} className="h-9">
                        <TableCell className="text-xs">{event.eventType.replace(/_/g, ' ')}</TableCell>
                        <TableCell>
                          <Badge variant={event.status === 'PENDING' ? 'default' : event.status === 'FAILED' ? 'destructive' : 'secondary'}>
                            {event.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-[11px] tabular-nums text-muted-foreground">{event.dedupKey}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
