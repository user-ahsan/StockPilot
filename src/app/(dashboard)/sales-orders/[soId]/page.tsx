'use client';

/** Sales order detail, invoice view, fulfillment & cancellation. */
import { useQuery } from '@tanstack/react-query';
import { use } from 'react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useIdempotentMutation } from '@/hooks/use-idempotent-mutation';
import { apiClient } from '@/lib/api-client';
import { formatMoney } from '@/lib/money';

interface SoDetailResponse {
  salesOrder: {
    id: string;
    soNumber: string;
    status: string;
    currency: string;
    subtotalCents: number;
    taxCents: number;
    discountCents: number;
    totalCents: number;
    customerName: string;
    customerEmail: string | null;
    locationCode?: string;
    fulfilledAt: string | null;
  };
  items: Array<{
    id: string;
    sku: string;
    variantName: string;
    quantity: number;
    unitPriceCents: number;
    unitCostSnapshotCents: number;
    currency: string;
    lineTotalCents: number;
  }>;
  movements: Array<{ id: number; movementType: string; quantityDelta: number; balanceAfter: number }>;
  timeline: Array<{ action: string; reason?: string | null }>;
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'CONFIRMED') return 'default';
  if (status === 'FULFILLED') return 'secondary';
  if (status === 'CANCELLED') return 'destructive';
  return 'outline';
}

export default function SalesOrderDetailPage({ params }: { params: Promise<{ soId: string }> }) {
  const { soId } = use(params);
  const [cancelReason, setCancelReason] = useState('');

  const { data, isLoading, isError, refetch } = useQuery<SoDetailResponse>({
    queryKey: ['sales-order', soId],
    queryFn: async (): Promise<SoDetailResponse> => {
      const res = await apiClient<SoDetailResponse>(`/api/v1/sales-orders?soId=${soId}`);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const fulfillMutation = useIdempotentMutation<unknown, Error, void>(
    async (_variables, idempotencyKey) => {
      const res = await apiClient(`/api/v1/sales-orders/${soId}/fulfill`, { method: 'POST', idempotencyKey, body: {} });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    {
      onSuccess: () => {
        toast.success('Order fulfilled & stock deducted');
        void refetch();
      },
      onError: (error) => toast.error(error.message),
    },
  );

  const cancelMutation = useIdempotentMutation<unknown, Error, string>(
    async (reason, idempotencyKey) => {
      const res = await apiClient(`/api/v1/sales-orders/${soId}/cancel`, {
        method: 'POST',
        idempotencyKey,
        body: { cancellationReason: reason },
      });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    {
      onSuccess: () => {
        toast.success('Order cancelled & reservation released');
        setCancelReason('');
        void refetch();
      },
      onError: (error) => toast.error(error.message),
    },
  );

  function submitCancel(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    cancelMutation.mutate(cancelReason);
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load sales order</AlertTitle>
        <AlertDescription>The sales order is temporarily unavailable.</AlertDescription>
      </Alert>
    );
  }

  const so = data.salesOrder;
  const canFulfill = so.status === 'CONFIRMED';
  const canCancel = so.status === 'CONFIRMED' || so.status === 'DRAFT';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold tabular-nums text-foreground">{so.soNumber}</h1>
          <p className="text-sm text-muted-foreground">
            {so.customerName} → {so.locationCode ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(so.status)}>{so.status.replace(/_/g, ' ')}</Badge>
          {canFulfill ? (
            <Button disabled={fulfillMutation.isPending} onClick={() => fulfillMutation.mutate()}>
              {fulfillMutation.isPending ? 'Dispatching…' : 'Fulfill & Dispatch Order (Deduct Stock)'}
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-card-foreground">Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">SKU</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Qty</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Unit Price</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Cost (snapshot)</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Line Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((item) => (
                <TableRow key={item.id} className="h-10">
                  <TableCell className="font-mono text-xs tabular-nums">{item.sku}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{item.quantity}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {formatMoney(item.unitPriceCents, item.currency)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {formatMoney(item.unitCostSnapshotCents, item.currency)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {formatMoney(item.lineTotalCents, item.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex flex-col items-end gap-1 text-sm">
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              Subtotal {formatMoney(so.subtotalCents, so.currency)}
            </span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              Tax {formatMoney(so.taxCents, so.currency)} · Discount {formatMoney(so.discountCents, so.currency)}
            </span>
            <span className="font-mono text-sm font-bold tabular-nums">Total {formatMoney(so.totalCents, so.currency)}</span>
          </div>
        </CardContent>
      </Card>

      {canCancel ? (
        <Card className="border-border bg-card text-card-foreground">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-card-foreground">Cancel &amp; release reservation</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitCancel} className="space-y-2">
              <Label htmlFor="cancel-reason">Cancellation reason (min 10 chars)</Label>
              <Input id="cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
              <Button type="submit" variant="destructive" disabled={cancelMutation.isPending}>
                Cancel &amp; Release Reservation
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="border-border bg-card text-card-foreground">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-card-foreground">Ledger entries</CardTitle>
          </CardHeader>
          <CardContent>
            {data.movements.length === 0 ? (
              <p className="text-xs text-muted-foreground">No ledger movements yet.</p>
            ) : (
              <Table>
                <TableBody>
                  {data.movements.map((movement) => (
                    <TableRow key={movement.id} className="h-9">
                      <TableCell className="text-xs">{movement.movementType.replace(/_/g, ' ')}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {movement.quantityDelta > 0 ? `+${movement.quantityDelta}` : movement.quantityDelta}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{movement.balanceAfter}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card text-card-foreground">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-card-foreground">Audit timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {data.timeline.length === 0 ? (
                <li className="text-xs text-muted-foreground">No audit entries yet.</li>
              ) : (
                data.timeline.map((entry, index) => (
                  <li key={`${entry.action}-${index}`} className="text-xs">
                    <span className="font-mono tabular-nums text-foreground">{entry.action}</span>
                    {entry.reason ? <span className="text-muted-foreground"> — {entry.reason}</span> : null}
                  </li>
                ))
              )}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Separator />
    </div>
  );
}
