'use client';

/** PO detail: stepper, line items, Manager approval, ledger history (Doc 4 §4.5.4). */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { use, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { PoStatusStepper } from '@/components/purchase-orders/po-status-stepper';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
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

interface PoDetailResponse {
  purchaseOrder: {
    id: string;
    poNumber: string;
    status: string;
    currency: string;
    subtotalCents: number;
    taxCents: number;
    shippingCents: number;
    totalCents: number;
    supplierName?: string;
    locationCode?: string;
    locationName?: string;
    submittedAt: string | null;
    approvedAt: string | null;
    supplierNotifiedAt: string | null;
    notes: string | null;
  };
  items: Array<{
    id: string;
    productVariantId: string;
    sku: string;
    variantName: string;
    orderedQty: number;
    receivedQty: number;
    remainingQty: number;
    unitCostCents: number;
    currency: string;
    lineTotalCents: number;
  }>;
  movements: Array<{ id: number; movementType: string; quantityDelta: number; balanceAfter: number; createdAt: string }>;
  timeline: Array<{ action: string; actorMemberId: string; createdAt?: string; reason?: string | null }>;
}

export default function PurchaseOrderDetailPage({ params }: { params: Promise<{ poId: string }> }) {
  const { poId } = use(params);
  const router = useRouter();
  const [rejectReason, setRejectReason] = useState('');

  const { data, isLoading, isError, refetch } = useQuery<{ detail: PoDetailResponse; viewerRole: string }>({
    queryKey: ['purchase-order', poId],
    queryFn: async () => {
      const res = await apiClient<PoDetailResponse>(`/api/v1/purchase-orders/${poId}`);
      if (!res.ok) throw new Error(res.error.message);
      const meta = res.meta as { viewerRole?: string };
      return { detail: res.data, viewerRole: meta.viewerRole ?? 'AUDITOR' };
    },
  });

  const decisionMutation = useIdempotentMutation<unknown, Error, { decision: 'APPROVE' | 'REJECT'; reason?: string }>(
    async (variables, idempotencyKey) => {
      const res = await apiClient(`/api/v1/purchase-orders/${poId}/approve`, {
        method: 'POST',
        idempotencyKey,
        body: variables,
      });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    {
      onSuccess: (_result, variables) => {
        toast.success(variables.decision === 'APPROVE' ? 'Purchase order approved & supplier notified' : 'Purchase order rejected');
        void refetch();
      },
      onError: (error) => toast.error(error.message),
    },
  );

  function reject(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    decisionMutation.mutate({ decision: 'REJECT', reason: rejectReason });
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
        <AlertTitle>Could not load purchase order</AlertTitle>
        <AlertDescription>The purchase order is temporarily unavailable.</AlertDescription>
      </Alert>
    );
  }

  const { detail, viewerRole } = data;
  const po = detail.purchaseOrder;
  const canApprove = (viewerRole === 'OWNER' || viewerRole === 'MANAGER') && po.status === 'SUBMITTED';
  const canReceive = po.status === 'ORDERED' || po.status === 'PARTIALLY_RECEIVED';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold tabular-nums text-foreground">{po.poNumber}</h1>
          <p className="text-sm text-muted-foreground">
            {po.supplierName ?? '—'} → {po.locationCode ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={po.status === 'SUBMITTED' ? 'default' : 'secondary'}>{po.status.replace(/_/g, ' ')}</Badge>
          {canReceive ? (
            <Button onClick={() => router.push(`/purchase-orders/${po.id}/receive`)}>Proceed to Receive Stock</Button>
          ) : null}
        </div>
      </div>

      <Card className="border-border bg-card text-card-foreground">
        <CardContent className="pt-6">
          <PoStatusStepper status={po.status} />
        </CardContent>
      </Card>

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-card-foreground">Line items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">SKU</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Ordered</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Received</TableHead>
                <TableHead className="w-40 text-xs uppercase tracking-wider text-muted-foreground">Progress</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Unit Cost</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Line Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.items.map((item) => (
                <TableRow key={item.id} className="h-10">
                  <TableCell className="font-mono text-xs tabular-nums">{item.sku || item.productVariantId.slice(0, 8)}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{item.orderedQty}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{item.receivedQty}</TableCell>
                  <TableCell>
                    <Progress value={item.orderedQty > 0 ? Math.round((item.receivedQty / item.orderedQty) * 100) : 0} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {formatMoney(item.unitCostCents, item.currency)}
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
              Subtotal {formatMoney(po.subtotalCents, po.currency)}
            </span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              Tax {formatMoney(po.taxCents, po.currency)} · Shipping {formatMoney(po.shippingCents, po.currency)}
            </span>
            <span className="font-mono text-sm font-bold tabular-nums">Total {formatMoney(po.totalCents, po.currency)}</span>
          </div>
        </CardContent>
      </Card>

      {canApprove ? (
        <Card className="border-border bg-card text-card-foreground">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-card-foreground">Manager decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              disabled={decisionMutation.isPending}
              onClick={() => decisionMutation.mutate({ decision: 'APPROVE' })}
            >
              Approve &amp; Notify Supplier
            </Button>
            <Separator />
            <form onSubmit={reject} className="space-y-2">
              <Label htmlFor="reject-reason">Rejection reason (min 10 chars)</Label>
              <Input id="reject-reason" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} />
              <Button type="submit" variant="destructive" disabled={decisionMutation.isPending}>
                Reject with Reason
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
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Type</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Delta</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.movements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center text-xs text-muted-foreground">
                      No stock received yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  detail.movements.map((movement) => (
                    <TableRow key={movement.id} className="h-9">
                      <TableCell className="text-xs">{movement.movementType.replace(/_/g, ' ')}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {movement.quantityDelta > 0 ? `+${movement.quantityDelta}` : movement.quantityDelta}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{movement.balanceAfter}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border bg-card text-card-foreground">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-card-foreground">Audit timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {detail.timeline.length === 0 ? (
                <li className="text-xs text-muted-foreground">No audit entries yet.</li>
              ) : (
                detail.timeline.map((entry, index) => (
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
    </div>
  );
}
