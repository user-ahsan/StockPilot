'use client';

/** Dedicated SKU detail page (Doc 4 §4.5.3). */
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState, type FormEvent } from 'react';
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
import { decimalStringToCents, formatMoney } from '@/lib/money';

interface VariantDetail {
  variant: {
    id: string;
    sku: string;
    barcodeUpc: string | null;
    variantName: string;
    attributes: Record<string, string>;
    currency: string;
    unitCostCents: number;
    sellingPriceCents: number;
    reorderPoint: number;
    reorderQty: number;
    isActive: boolean;
    productName: string;
    brand: string;
    category: string;
    supplierName: string;
    leadTimeDays: number;
    marginBps: number;
  };
  totals: { onHandQty: number; reservedQty: number; availableQty: number };
  balances: Array<{
    locationCode: string;
    locationName: string;
    onHandQty: number;
    reservedQty: number;
    availableQty: number;
  }>;
  movements: Array<{
    id: number;
    createdAt: string;
    movementType: string;
    quantityDelta: number;
    balanceAfter: number;
    locationCode: string;
    actorName: string;
  }>;
}

export default function VariantDetailPage({ params }: { params: Promise<{ variantId: string }> }) {
  const { variantId } = use(params);
  const router = useRouter();
  const [unitCost, setUnitCost] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');

  const { data, isLoading, isError, refetch } = useQuery<VariantDetail>({
    queryKey: ['variant', variantId],
    queryFn: async (): Promise<VariantDetail> => {
      const res = await apiClient<VariantDetail>(`/api/v1/products/${variantId}`);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const patchMutation = useIdempotentMutation<unknown, Error, Record<string, unknown>>(
    async (variables, idempotencyKey) => {
      const res = await apiClient<unknown>(`/api/v1/products/${variantId}`, {
        method: 'PATCH',
        body: variables,
        idempotencyKey,
      });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    {
      onSuccess: () => {
        toast.success('Pricing updated');
        setUnitCost('');
        setSellingPrice('');
        void refetch();
      },
      onError: (error) => toast.error(error.message),
    },
  );

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const payload: Record<string, unknown> = {};
    if (unitCost) payload.unitCostCents = decimalStringToCents(unitCost);
    if (sellingPrice) payload.sellingPriceCents = decimalStringToCents(sellingPrice);
    if (Object.keys(payload).length === 0) {
      toast.error('Nothing to update');
      return;
    }
    patchMutation.mutate(payload);
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load SKU</AlertTitle>
        <AlertDescription>The variant detail is temporarily unavailable.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold tabular-nums text-foreground">{data.variant.sku}</h1>
          <p className="text-sm text-muted-foreground">
            {data.variant.productName} · {data.variant.brand}
          </p>
        </div>
        <Button variant="outline" onClick={() => router.push('/catalog')}>
          Back to catalog
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border bg-card text-card-foreground">
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">On Hand</CardTitle></CardHeader>
          <CardContent><p className="font-mono text-2xl font-bold tabular-nums">{data.totals.onHandQty}</p></CardContent>
        </Card>
        <Card className="border-border bg-card text-card-foreground">
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Reserved</CardTitle></CardHeader>
          <CardContent><p className="font-mono text-2xl font-bold tabular-nums">{data.totals.reservedQty}</p></CardContent>
        </Card>
        <Card className="border-border bg-card text-card-foreground">
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Available</CardTitle></CardHeader>
          <CardContent><p className="font-mono text-2xl font-bold tabular-nums">{data.totals.availableQty}</p></CardContent>
        </Card>
        <Card className="border-border bg-card text-card-foreground">
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Valuation</CardTitle></CardHeader>
          <CardContent>
            <p className="font-mono text-lg font-bold tabular-nums">
              {formatMoney(data.variant.unitCostCents * data.totals.onHandQty, data.variant.currency)}
            </p>
            <Badge variant="outline" className="font-mono tabular-nums">
              margin {(data.variant.marginBps / 100).toFixed(1)}%
            </Badge>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="border-border bg-card text-card-foreground lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base font-semibold text-card-foreground">Multi-location stock</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Location</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">On Hand</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Reserved</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Available</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.balances.map((balance) => (
                  <TableRow key={balance.locationCode} className="h-9">
                    <TableCell className="text-xs">
                      <span className="font-mono tabular-nums">{balance.locationCode}</span>
                      <span className="block text-muted-foreground">{balance.locationName}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{balance.onHandQty}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{balance.reservedQty}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold tabular-nums">{balance.availableQty}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border bg-card text-card-foreground">
          <CardHeader className="pb-2"><CardTitle className="text-base font-semibold text-card-foreground">Supplier &amp; pricing</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Supplier</p>
              <p>{data.variant.supplierName}</p>
              <Badge variant="secondary" className="font-mono tabular-nums">{data.variant.leadTimeDays}d lead</Badge>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Unit cost</span>
              <span className="font-mono text-xs tabular-nums">{formatMoney(data.variant.unitCostCents, data.variant.currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Selling price</span>
              <span className="font-mono text-xs tabular-nums">{formatMoney(data.variant.sellingPriceCents, data.variant.currency)}</span>
            </div>
            <Separator />
            <form onSubmit={submit} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="detail-cost">New unit cost</Label>
                <Input id="detail-cost" value={unitCost} placeholder="0.00" onChange={(event) => setUnitCost(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="detail-price">New selling price</Label>
                <Input id="detail-price" value={sellingPrice} placeholder="0.00" onChange={(event) => setSellingPrice(event.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={patchMutation.isPending}>
                {patchMutation.isPending ? 'Saving…' : 'Update pricing'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-card-foreground">Ledger history</CardTitle>
          <p className="text-xs text-muted-foreground">Latest {data.movements.length} movements</p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Date</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Type</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Delta</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Balance</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Location</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Actor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.movements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No ledger movements recorded.
                  </TableCell>
                </TableRow>
              ) : (
                data.movements.map((movement) => (
                  <TableRow key={movement.id} className="h-9">
                    <TableCell className="font-mono text-xs tabular-nums">{movement.createdAt.slice(0, 19).replace('T', ' ')}</TableCell>
                    <TableCell className="text-xs">{movement.movementType.replace(/_/g, ' ')}</TableCell>
                    <TableCell className={`text-right font-mono text-xs tabular-nums ${movement.quantityDelta < 0 ? 'text-destructive' : 'text-foreground'}`}>
                      {movement.quantityDelta > 0 ? `+${movement.quantityDelta}` : movement.quantityDelta}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{movement.balanceAfter}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{movement.locationCode}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{movement.actorName}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Return to <Link href="/catalog" className="text-primary underline-offset-4 hover:underline">catalog</Link>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
