'use client';

/** POS / sales order builder with live availability + authoritative pricing. */
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useIdempotentMutation } from '@/hooks/use-idempotent-mutation';
import { apiClient } from '@/lib/api-client';
import { getPublicEnv } from '@/lib/env';
import { generateIdempotencyKey } from '@/lib/idempotency-client';
import { formatMoney } from '@/lib/money';

interface VariantOption {
  id: string;
  sku: string;
  variantName: string;
  sellingPriceCents: number;
  unitCostCents: number | null;
  availableQty: number;
  currency: string;
}

const LOCATIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'a0000000-0000-4000-8000-000000000101', label: 'WH-CENTRAL • Central Warehouse' },
  { id: 'a0000000-0000-4000-8000-000000000102', label: 'STORE-MAIN • Main Showroom' },
  { id: 'a0000000-0000-4000-8000-000000000103', label: 'STORE-DOWNTOWN • Downtown Branch' },
];
const LOCATION_LABELS: Record<string, string> = Object.fromEntries(LOCATIONS.map((l) => [l.id, l.label]));

interface Line {
  key: string;
  productVariantId: string;
  qty: string;
}

export default function NewSalesOrderPage() {
  const router = useRouter();
  const [locationId, setLocationId] = useState(LOCATIONS[0].id);
  const [customerName, setCustomerName] = useState('');
  const [currency] = useState('USD');
  const [taxBps, setTaxBps] = useState('0');
  const [discount, setDiscount] = useState('0.00');
  const [lines, setLines] = useState<Line[]>([{ key: 'line-0', productVariantId: '', qty: '1' }]);

  const isDemo = getPublicEnv().NEXT_PUBLIC_APP_ENV === 'demo' || getPublicEnv().NEXT_PUBLIC_APP_ENV === 'dev';

  const { data: variants } = useQuery<VariantOption[]>({
    queryKey: ['products', locationId, '', 'ALL', 'ALL', 'ALL'],
    queryFn: async () => {
      const res = await apiClient<VariantOption[]>(`/api/v1/products?pageSize=200&locationId=${locationId}`);
      return res.ok ? res.data : [];
    },
  });

  const { data: viewerRole } = useQuery<string>({
    queryKey: ['products', 'role'],
    queryFn: async () => {
      const res = await apiClient<VariantOption[]>('/api/v1/products?pageSize=1');
      const meta = res.ok ? (res.meta as { viewerRole?: string }) : undefined;
      return meta?.viewerRole ?? 'AUDITOR';
    },
  });

  const canDiscount = viewerRole === 'OWNER' || viewerRole === 'MANAGER';

  const createMutation = useIdempotentMutation<{ id: string }, Error, void>(
    async (_variables, idempotencyKey) => {
      const items = lines
        .filter((line) => line.productVariantId)
        .map((line) => ({ productVariantId: line.productVariantId, quantity: Number(line.qty) }));
      if (!customerName.trim() || items.length === 0) throw new Error('Enter a customer name and at least one line item.');

      const res = await apiClient<{ id: string }>('/api/v1/sales-orders', {
        method: 'POST',
        idempotencyKey,
        body: {
          locationId,
          customerName: customerName.trim(),
          currency,
          taxRateBps: Number(taxBps) || 0,
          discountCents: canDiscount && discount ? Math.round(Number(discount) * 100) : 0,
          confirmImmediately: true,
          items,
        },
      });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    {
      onSuccess: (so) => {
        toast.success('Sales order confirmed & stock reserved');
        router.push(`/sales-orders/${so.id}`);
      },
      onError: (error) => toast.error(error.message),
    },
  );

  async function simulateRace(): Promise<void> {
    const line = lines.find((entry) => entry.productVariantId);
    if (!line) {
      toast.error('Select a SKU first');
      return;
    }
    toast.info('Firing 5 concurrent 1-unit sales at the same SKU…');
    const fire = () =>
      apiClient('/api/v1/sales-orders', {
        method: 'POST',
        idempotencyKey: generateIdempotencyKey(),
        body: {
          locationId,
          customerName: 'Race Simulation',
          currency,
          taxRateBps: 0,
          discountCents: 0,
          confirmImmediately: true,
          items: [{ productVariantId: line.productVariantId, quantity: 1 }],
        },
      });
    const results = await Promise.all([fire(), fire(), fire(), fire(), fire()]);
    const ok = results.filter((res) => res.ok).length;
    toast.message(`Race result: ${ok} confirmed, ${5 - ok} blocked by oversell protection`);
  }

  const subtotalCents = lines.reduce((sum, line) => {
    const variant = variants?.find((entry) => entry.id === line.productVariantId);
    return sum + (variant ? variant.sellingPriceCents * (Number(line.qty) || 0) : 0);
  }, 0);
  const taxCents = Math.round((subtotalCents * (Number(taxBps) || 0)) / 10_000);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">New Sales Order</h1>
          <p className="text-sm text-muted-foreground">Prices are read from the catalog — never from the client.</p>
        </div>
        {isDemo ? (
          <Button variant="outline" onClick={() => void simulateRace()}>
            Simulate 5-Rep Concurrent Oversell Race on Last 2 Units
          </Button>
        ) : null}
      </div>

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-card-foreground">Customer</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="so-customer">Customer name</Label>
            <Input id="so-customer" value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Fulfilling location</Label>
            <Select value={locationId} items={LOCATION_LABELS} onValueChange={(value) => setLocationId(String(value))}>
              <SelectTrigger className="w-full">
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="so-tax">Tax (basis points)</Label>
            <Input id="so-tax" value={taxBps} onChange={(event) => setTaxBps(event.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold text-card-foreground">Line items</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLines((current) => [...current, { key: `line-${current.length}`, productVariantId: '', qty: '1' }])}
          >
            <Plus className="h-4 w-4" />
            Add line
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((line) => {
            const variant = variants?.find((entry) => entry.id === line.productVariantId);
            return (
              <div key={line.key} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_120px_1fr_auto]">
                <Select
                  value={line.productVariantId || undefined}
                  items={Object.fromEntries((variants ?? []).map((v) => [v.id, `${v.sku} • ${v.variantName}`]))}
                  onValueChange={(value) =>
                    setLines((current) => current.map((entry) => (entry.key === line.key ? { ...entry, productVariantId: String(value) } : entry)))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(variants ?? []).map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.sku} • {option.variantName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  value={line.qty}
                  onChange={(event) =>
                    setLines((current) => current.map((entry) => (entry.key === line.key ? { ...entry, qty: event.target.value } : entry)))
                  }
                  aria-label="Quantity"
                />
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {variant ? (
                    <>
                      <span className="font-mono tabular-nums">{formatMoney(variant.sellingPriceCents, variant.currency)}</span>
                      <Badge variant={variant.availableQty > 0 ? 'secondary' : 'destructive'} className="font-mono tabular-nums">
                        {variant.availableQty} available
                      </Badge>
                      {Number(line.qty) > variant.availableQty ? (
                        <Badge variant="destructive">exceeds available</Badge>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">Select a SKU</span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove line"
                  disabled={lines.length === 1}
                  onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="border-border bg-card text-card-foreground lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-card-foreground">Discount</CardTitle>
          </CardHeader>
          <CardContent>
            {canDiscount ? (
              <div className="space-y-2">
                <Label htmlFor="so-discount">Order discount ({currency})</Label>
                <Input id="so-discount" className="w-40" value={discount} onChange={(event) => setDiscount(event.target.value)} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Discounts require the OWNER or MANAGER role.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card text-card-foreground">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-card-foreground">Totals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Subtotal</span>
              <span className="font-mono text-xs tabular-nums">{formatMoney(subtotalCents, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">Tax</span>
              <span className="font-mono text-xs tabular-nums">{formatMoney(taxCents, currency)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-2">
              <span className="text-xs font-medium">Total</span>
              <span className="font-mono text-sm font-bold tabular-nums">
                {formatMoney(Math.max(0, subtotalCents + taxCents - Math.round(Number(discount) * 100 || 0)), currency)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {createMutation.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not confirm sales order</AlertTitle>
          <AlertDescription>{createMutation.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <Button disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
        {createMutation.isPending ? 'Reserving stock…' : 'Confirm & Reserve Stock'}
      </Button>
    </div>
  );
}
