'use client';

/** Purchase order list (Doc 4 §4.5.4). */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdaptivePolling } from '@/hooks/use-adaptive-polling';
import { apiClient } from '@/lib/api-client';
import { formatMoney } from '@/lib/money';

interface PoRow {
  id: string;
  poNumber: string;
  status: string;
  currency: string;
  totalCents: number;
  supplierName?: string;
  locationCode?: string;
  createdAt: string;
  submittedAt: string | null;
}

const TAB_FILTERS: ReadonlyArray<{ value: string; label: string; status?: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending Approval', status: 'SUBMITTED' },
  { value: 'open', label: 'Open Receiving', status: 'ORDERED,PARTIALLY_RECEIVED' },
  { value: 'drafts', label: 'Drafts', status: 'DRAFT' },
  { value: 'received', label: 'Received', status: 'RECEIVED' },
];

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'SUBMITTED') return 'default';
  if (status === 'ORDERED' || status === 'PARTIALLY_RECEIVED') return 'secondary';
  if (status === 'REJECTED' || status === 'CANCELLED') return 'destructive';
  return 'outline';
}

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [tab, setTab] = useState('all');
  useAdaptivePolling({ mode: 'active' });

  const statusFilter = TAB_FILTERS.find((entry) => entry.value === tab)?.status;

  const { data, isLoading, isError } = useQuery<PoRow[]>({
    queryKey: ['purchase-orders', tab],
    queryFn: async (): Promise<PoRow[]> => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const res = await apiClient<PoRow[]>(`/api/v1/purchase-orders?${params.toString()}`);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Purchase Orders</h1>
          <p className="text-sm text-muted-foreground">Procurement lifecycle &amp; receiving queue.</p>
        </div>
        <Button onClick={() => router.push('/purchase-orders/new')}>New Purchase Order</Button>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList>
          {TAB_FILTERS.map((entry) => (
            <TabsTrigger key={entry.value} value={entry.value}>
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load purchase orders</AlertTitle>
          <AlertDescription>The purchase order queue is temporarily unavailable.</AlertDescription>
        </Alert>
      ) : null}

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-card-foreground">Queue</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">PO #</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Supplier</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Destination</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Status</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Total</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      No purchase orders in this view.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((po) => (
                    <TableRow key={po.id} className="h-10">
                      <TableCell className="font-mono text-xs font-medium tabular-nums">{po.poNumber}</TableCell>
                      <TableCell className="text-sm">{po.supplierName ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{po.locationCode ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(po.status)}>{po.status.replace(/_/g, ' ')}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatMoney(po.totalCents, po.currency)}
                      </TableCell>
                      <TableCell className="space-x-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => router.push(`/purchase-orders/${po.id}`)}>
                          Inspect
                        </Button>
                        {po.status === 'SUBMITTED' ? (
                          <Button size="sm" onClick={() => router.push(`/purchase-orders/${po.id}`)}>
                            Review &amp; Approve
                          </Button>
                        ) : null}
                        {po.status === 'ORDERED' || po.status === 'PARTIALLY_RECEIVED' ? (
                          <Button variant="secondary" size="sm" onClick={() => router.push(`/purchase-orders/${po.id}/receive`)}>
                            Receive Stock
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
