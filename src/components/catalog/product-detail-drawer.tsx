'use client';

/** Slide-over SKU detail: per-location balances, role-gated edit, ledger history. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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

export interface ProductDetailDrawerProps {
  variantId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEditPricing: boolean;
}

interface EditForm {
  variantName: string;
  unitCost: string;
  sellingPrice: string;
  reorderPoint: string;
  reorderQty: string;
}

const EMPTY_FORM: EditForm = { variantName: '', unitCost: '', sellingPrice: '', reorderPoint: '', reorderQty: '' };

export function ProductDetailDrawer({ variantId, open, onOpenChange, canEditPricing }: ProductDetailDrawerProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);

  const { data, isLoading, isError } = useQuery<VariantDetail>({
    queryKey: ['variant', variantId],
    enabled: open && Boolean(variantId),
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
        toast.success('Variant updated');
        setForm(EMPTY_FORM);
        void queryClient.invalidateQueries({ queryKey: ['variant', variantId] });
        void queryClient.invalidateQueries({ queryKey: ['products'] });
      },
      onError: (error) => toast.error(error.message),
    },
  );

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const payload: Record<string, unknown> = {};
    if (form.variantName) payload.variantName = form.variantName;
    if (form.unitCost) payload.unitCostCents = decimalStringToCents(form.unitCost);
    if (form.sellingPrice) payload.sellingPriceCents = decimalStringToCents(form.sellingPrice);
    if (form.reorderPoint) payload.reorderPoint = Number(form.reorderPoint);
    if (form.reorderQty) payload.reorderQty = Number(form.reorderQty);
    if (Object.keys(payload).length === 0) {
      toast.error('Nothing to update');
      return;
    }
    patchMutation.mutate(payload);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="font-mono tabular-nums">
            {data?.variant.sku ?? variantId}
          </SheetTitle>
          <SheetDescription>{data?.variant.productName ?? 'SKU detail & stock ledger'}</SheetDescription>
        </SheetHeader>

        <div className="space-y-6 p-4">
          {isError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load SKU</AlertTitle>
              <AlertDescription>The variant detail is temporarily unavailable.</AlertDescription>
            </Alert>
          ) : null}

          {isLoading || !data ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <>
              <section className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{data.variant.category}</Badge>
                  <Badge variant="secondary">{data.variant.brand}</Badge>
                  <Badge variant={data.variant.isActive ? 'default' : 'outline'}>
                    {data.variant.isActive ? 'ACTIVE' : 'DISCONTINUED'}
                  </Badge>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    margin {(data.variant.marginBps / 100).toFixed(1)}%
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div>
                    <p className="text-muted-foreground">On hand</p>
                    <p className="font-mono text-lg font-bold tabular-nums">{data.totals.onHandQty}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Reserved</p>
                    <p className="font-mono text-lg font-bold tabular-nums">{data.totals.reservedQty}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Available</p>
                    <p className="font-mono text-lg font-bold tabular-nums">{data.totals.availableQty}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Supplier</p>
                    <p className="text-sm">{data.variant.supplierName}</p>
                  </div>
                </div>
              </section>

              <Separator />

              <section className="space-y-2">
                <h3 className="text-base font-semibold text-card-foreground">Balances by location</h3>
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
              </section>

              {canEditPricing ? (
                <>
                  <Separator />
                  <section className="space-y-3">
                    <h3 className="text-base font-semibold text-card-foreground">Edit metadata &amp; pricing</h3>
                    <form onSubmit={submit} className="grid grid-cols-2 gap-3">
                      <div className="col-span-2 space-y-2">
                        <Label htmlFor="drawer-name">Variant name</Label>
                        <Input
                          id="drawer-name"
                          value={form.variantName}
                          placeholder={data.variant.variantName}
                          onChange={(event) => setForm({ ...form, variantName: event.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="drawer-cost">Unit cost ({data.variant.currency})</Label>
                        <Input
                          id="drawer-cost"
                          value={form.unitCost}
                          placeholder="0.00"
                          onChange={(event) => setForm({ ...form, unitCost: event.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="drawer-price">Selling price ({data.variant.currency})</Label>
                        <Input
                          id="drawer-price"
                          value={form.sellingPrice}
                          placeholder="0.00"
                          onChange={(event) => setForm({ ...form, sellingPrice: event.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="drawer-reorder-point">Reorder point</Label>
                        <Input
                          id="drawer-reorder-point"
                          value={form.reorderPoint}
                          placeholder={String(data.variant.reorderPoint)}
                          onChange={(event) => setForm({ ...form, reorderPoint: event.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="drawer-reorder-qty">Reorder qty</Label>
                        <Input
                          id="drawer-reorder-qty"
                          value={form.reorderQty}
                          placeholder={String(data.variant.reorderQty)}
                          onChange={(event) => setForm({ ...form, reorderQty: event.target.value })}
                        />
                      </div>
                      <div className="col-span-2">
                        <Button type="submit" disabled={patchMutation.isPending}>
                          {patchMutation.isPending ? 'Saving…' : 'Save changes'}
                        </Button>
                      </div>
                    </form>
                  </section>
                </>
              ) : null}

              <Separator />

              <section className="space-y-2">
                <h3 className="text-base font-semibold text-card-foreground">Ledger history</h3>
                <p className="text-xs text-muted-foreground">
                  Total valuation {formatMoney(data.variant.unitCostCents * data.totals.onHandQty, data.variant.currency)}
                </p>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Date</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Type</TableHead>
                      <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Delta</TableHead>
                      <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Balance</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Actor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.movements.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                          No ledger movements recorded.
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.movements.map((movement) => (
                        <TableRow key={movement.id} className="h-9">
                          <TableCell className="font-mono text-xs tabular-nums">
                            {movement.createdAt.slice(0, 19).replace('T', ' ')}
                          </TableCell>
                          <TableCell className="text-xs">{movement.movementType.replace(/_/g, ' ')}</TableCell>
                          <TableCell className={`text-right font-mono text-xs tabular-nums ${movement.quantityDelta < 0 ? 'text-destructive' : 'text-foreground'}`}>
                            {movement.quantityDelta > 0 ? `+${movement.quantityDelta}` : movement.quantityDelta}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">{movement.balanceAfter}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{movement.actorName}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
