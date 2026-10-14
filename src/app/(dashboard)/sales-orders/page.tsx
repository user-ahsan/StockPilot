'use client';

/** Sales orders list (Doc 1 Module D). */
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

interface SoRow {
  id: string;
  soNumber: string;
  status: string;
  currency: string;
  totalCents: number;
  customerName: string;
  locationCode?: string;
  createdAt: string;
}

const TAB_FILTERS: ReadonlyArray<{ value: string; label: string; status?: string }> = [
  { value: 'all', label: 'All' },
  { value: 'confirmed', label: 'Confirmed [Reserved]', status: 'CONFIRMED' },
  { value: 'fulfilled', label: 'Fulfilled', status: 'FULFILLED' },
  { value: 'cancelled', label: 'Cancelled', status: 'CANCELLED' },
];

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'CONFIRMED') return 'default';
  if (status === 'FULFILLED') return 'secondary';
  if (status === 'CANCELLED') return 'destructive';
  return 'outline';
}

export default function SalesOrdersPage() {
  const router = useRouter();
  const [tab, setTab] = useState('all');
  useAdaptivePolling({ mode: 'active' });

  const statusFilter = TAB_FILTERS.find((entry) => entry.value === tab)?.status;

  const { data, isLoading, isError } = useQuery<SoRow[]>({
    queryKey: ['sales-orders', tab],
    queryFn: async (): Promise<SoRow[]> => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const res = await apiClient<SoRow[]>(`/api/v1/sales-orders?${params.toString()}`);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Sales Orders</h1>
          <p className="text-sm text-muted-foreground">Reservations, fulfillment and dispatch.</p>
        </div>
        <Button onClick={() => router.push('/sales-orders/new')}>New Sales Order</Button>
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
          <AlertTitle>Could not load sales orders</AlertTitle>
          <AlertDescription>The sales order queue is temporarily unavailable.</AlertDescription>
        </Alert>
      ) : null}

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-card-foreground">Queue</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <div className="space-y-2">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">SO #</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Customer</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Location</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Status</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Total</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      No sales orders in this view.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((so) => (
                    <TableRow key={so.id} className="h-10">
                      <TableCell className="font-mono text-xs font-medium tabular-nums">{so.soNumber}</TableCell>
                      <TableCell className="text-sm">{so.customerName}</TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{so.locationCode ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(so.status)}>{so.status.replace(/_/g, ' ')}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatMoney(so.totalCents, so.currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => router.push(`/sales-orders/${so.id}`)}>
                          Inspect
                        </Button>
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
