'use client';

/** Tablet-friendly PO stock receipt (Doc 4 §4.5.4) with live conflict reconciliation. */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useIdempotentMutation } from '@/hooks/use-idempotent-mutation';
import { apiClient } from '@/lib/api-client';
import { getPublicEnv } from '@/lib/env';
import { generateIdempotencyKey } from '@/lib/idempotency-client';
import { formatMoney } from '@/lib/money';

interface PoDetailResponse {
  purchaseOrder: { id: string; poNumber: string; status: string; currency: string; locationCode?: string };
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
  }>;
}

interface OverReceiptLine {
  productVariantId: string;
  sku: string;
  orderedQty: number;
  alreadyReceivedQty: number;
  attemptedQty: number;
  remainingReceivableQty: number;
}

interface OverReceiptDetails {
  status: string;
  poNumber: string;
  lines: OverReceiptLine[];
}

export default function ReceivePurchaseOrderPage({ params }: { params: Promise<{ poId: string }> }) {
  const { poId } = use(params);
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<OverReceiptDetails | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<PoDetailResponse>({
    queryKey: ['purchase-order', poId],
    queryFn: async (): Promise<PoDetailResponse> => {
      const res = await apiClient<PoDetailResponse>(`/api/v1/purchase-orders/${poId}`);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const receiveMutation = useIdempotentMutation<unknown, Error, void>(
    async (_variables, idempotencyKey) => {
      const items = (data?.items ?? [])
        .map((item) => ({ productVariantId: item.productVariantId, receiveQty: Number(quantities[item.productVariantId] ?? 0), notes: notes[item.productVariantId] || undefined }))
        .filter((item) => item.receiveQty > 0);
      if (items.length === 0) throw new Error('Enter a receive quantity for at least one line.');

      const res = await apiClient(`/api/v1/purchase-orders/${poId}/receive`, {
        method: 'POST',
        idempotencyKey,
        body: { items },
      });

      if (!res.ok) {
        if (res.status === 409 && res.error.code === 'OVER_RECEIPT_PREVENTED') {
          const details = res.error.details as OverReceiptDetails | undefined;
          if (details) {
            setConflict(details);
            setQuantities((current) => {
              const next = { ...current };
              for (const line of details.lines) next[line.productVariantId] = String(line.remainingReceivableQty);
              return next;
            });
            void refetch();
          }
        }
        throw new Error(res.error.message);
      }
      return res.data;
    },
    {
      onSuccess: () => {
        toast.success('Stock received');
        setConflict(null);
        void refetch();
      },
      onError: (error) => toast.error(error.message),
    },
  );

  async function simulateRace(): Promise<void> {
    const items = (data?.items ?? []).map((item) => ({
      productVariantId: item.productVariantId,
      receiveQty: item.remainingQty,
    }));
    if (items.length === 0) {
      toast.error('Nothing left to receive');
      return;
    }
    toast.info('Firing two concurrent receipts with distinct Idempotency-Keys…');
    const fire = () =>
      apiClient(`/api/v1/purchase-orders/${poId}/receive`, {
        method: 'POST',
        idempotencyKey: generateIdempotencyKey(),
        body: { items },
      });
    const [a, b] = await Promise.all([fire(), fire()]);
    const okCount = [a, b].filter((res) => res.ok).length;
    const conflictResult = [a, b].find((res) => !res.ok && res.status === 409);
    toast.message(`Simulated race: ${okCount} succeeded, ${2 - okCount} blocked`);
    if (conflictResult && !conflictResult.ok) {
      const details = conflictResult.error.details as OverReceiptDetails | undefined;
      if (details) setConflict(details);
    }
    void refetch();
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
        <AlertDescription>The receiving screen is temporarily unavailable.</AlertDescription>
      </Alert>
    );
  }

  const isDemo = getPublicEnv().NEXT_PUBLIC_APP_ENV === 'demo' || getPublicEnv().NEXT_PUBLIC_APP_ENV === 'dev';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold tabular-nums text-foreground">{data.purchaseOrder.poNumber}</h1>
          <p className="text-sm text-muted-foreground">Receiving at {data.purchaseOrder.locationCode ?? '—'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{data.purchaseOrder.status.replace(/_/g, ' ')}</Badge>
          <Button variant="outline" onClick={() => router.push(`/purchase-orders/${poId}`)}>
            Back to PO
          </Button>
        </div>
      </div>

      {conflict ? (
        <Alert variant="destructive">
          <AlertTitle>Concurrent receipt prevented — quantities updated</AlertTitle>
          <AlertDescription>
            {conflict.lines
              .map((line) => `${line.sku || line.productVariantId.slice(0, 8)}: remaining ${line.remainingReceivableQty}`)
              .join(' • ')}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold text-card-foreground">Receive quantities</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setQuantities(Object.fromEntries(data.items.map((item) => [item.productVariantId, String(item.remainingQty)])))
              }
            >
              Fill All Remaining
            </Button>
            {isDemo ? (
              <Button variant="outline" size="sm" onClick={() => void simulateRace()}>
                Simulate Concurrent 2-Clerk Receipt Race
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.items.map((item) => {
            const qty = Number(quantities[item.productVariantId] ?? 0);
            const after = item.receivedQty + (Number.isFinite(qty) ? qty : 0);
            return (
              <div key={item.id} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-xs font-medium tabular-nums">{item.sku}</p>
                    <p className="text-xs text-muted-foreground">{item.variantName}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Decrease"
                      className="h-11 w-11"
                      onClick={() =>
                        setQuantities((current) => ({
                          ...current,
                          [item.productVariantId]: String(Math.max(0, Number(current[item.productVariantId] ?? 0) - 1)),
                        }))
                      }
                    >
                      −
                    </Button>
                    <Input
                      className="w-20 text-center font-mono tabular-nums"
                      value={quantities[item.productVariantId] ?? ''}
                      onChange={(event) =>
                        setQuantities((current) => ({ ...current, [item.productVariantId]: event.target.value }))
                      }
                      inputMode="numeric"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Increase"
                      className="h-11 w-11"
                      onClick={() =>
                        setQuantities((current) => ({
                          ...current,
                          [item.productVariantId]: String(Number(current[item.productVariantId] ?? 0) + 1),
                        }))
                      }
                    >
                      +
                    </Button>
                  </div>
                </div>
                <Progress value={item.orderedQty > 0 ? Math.round((item.receivedQty / item.orderedQty) * 100) : 0} />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {item.receivedQty} → +{Number.isFinite(qty) ? qty : 0} → {after} / {item.orderedQty}
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {formatMoney(item.unitCostCents, item.currency)} each
                  </span>
                </div>
                <Input
                  value={notes[item.productVariantId] ?? ''}
                  placeholder="Condition / batch notes"
                  onChange={(event) => setNotes((current) => ({ ...current, [item.productVariantId]: event.target.value }))}
                />
              </div>
            );
          })}

          <Button
            className="w-full"
            disabled={receiveMutation.isPending}
            onClick={() => receiveMutation.mutate()}
          >
            {receiveMutation.isPending ? 'Receiving Stock…' : 'Confirm Stock Receipt'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
