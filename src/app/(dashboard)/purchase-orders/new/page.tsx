'use client';

/** Draft PO builder (Doc 4 §4.5.4). */
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { addMoney, calculateLineTotalCents, decimalStringToCents, formatMoney } from '@/lib/money';

interface SupplierOption {
  id: string;
  code: string;
  name: string;
}

interface VariantOption {
  id: string;
  sku: string;
  variantName: string;
  unitCostCents: number | null;
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
  unitCost: string;
}

const EMPTY_LINE: Line = { key: '', productVariantId: '', qty: '1', unitCost: '' };

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState(LOCATIONS[0].id);
  const [currency, setCurrency] = useState('USD');
  const [tax, setTax] = useState('0.00');
  const [shipping, setShipping] = useState('0.00');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE, key: 'line-0' }]);

  const { data: suppliers } = useQuery<SupplierOption[]>({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const res = await apiClient<SupplierOption[]>('/api/v1/suppliers');
      return res.ok ? res.data : [];
    },
  });

  const { data: variants } = useQuery<VariantOption[]>({
    queryKey: ['products', 'ALL', '', 'ALL', 'ALL', 'ALL'],
    queryFn: async () => {
      const res = await apiClient<VariantOption[]>('/api/v1/products?pageSize=200');
      return res.ok ? res.data : [];
    },
  });

  const createMutation = useIdempotentMutation<{ id: string }, Error, { submit: boolean }>(
    async (variables, idempotencyKey) => {
      const items = lines
        .filter((line) => line.productVariantId)
        .map((line) => ({
          productVariantId: line.productVariantId,
          orderedQty: Number(line.qty),
          unitCostCents: line.unitCost ? decimalStringToCents(line.unitCost) : 0,
        }));
      if (!supplierId || items.length === 0) throw new Error('Select a supplier and at least one line item.');

      const created = await apiClient<{ id: string }>('/api/v1/purchase-orders', {
        method: 'POST',
        idempotencyKey,
        body: {
          supplierId,
          locationId,
          currency,
          taxCents: decimalStringToCents(tax),
          shippingCents: decimalStringToCents(shipping),
          notes: notes || undefined,
          items,
        },
      });
      if (!created.ok) throw new Error(created.error.message);

      if (variables.submit) {
        const submitted = await apiClient(`/api/v1/purchase-orders/${created.data.id}/submit`, {
          method: 'POST',
          body: { notes: notes || undefined },
        });
        if (!submitted.ok) throw new Error(submitted.error.message);
      }
      return created.data;
    },
    {
      onSuccess: (po, variables) => {
        toast.success(variables.submit ? 'Purchase order submitted for approval' : 'Draft saved');
        router.push(`/purchase-orders/${po.id}`);
      },
      onError: (error) => toast.error(error.message),
    },
  );

  function updateLine(key: string, patch: Partial<Line>): void {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addLine(): void {
    setLines((current) => [...current, { ...EMPTY_LINE, key: `line-${current.length}-${current.length}` }]);
  }

  function selectVariant(key: string, variantId: string): void {
    const variant = variants?.find((entry) => entry.id === variantId);
    updateLine(key, {
      productVariantId: variantId,
      unitCost: variant?.unitCostCents !== null && variant?.unitCostCents !== undefined ? (variant.unitCostCents / 100).toFixed(2) : '',
    });
  }

  const subtotalCents = lines.reduce((sum, line) => {
    const qty = Number(line.qty) || 0;
    const cost = line.unitCost ? decimalStringToCents(line.unitCost) : 0;
    return addMoney(sum, calculateLineTotalCents(qty, cost), currency, currency);
  }, 0);
  const taxCents = tax ? decimalStringToCents(tax) : 0;
  const shippingCents = shipping ? decimalStringToCents(shipping) : 0;
  const totalCents = subtotalCents + taxCents + shippingCents;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">New Purchase Order</h1>
        <p className="text-sm text-muted-foreground">Draft a procurement order and submit it for approval.</p>
      </div>

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-card-foreground">Header</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Supplier</Label>
            <Select
              value={supplierId || undefined}
              items={Object.fromEntries((suppliers ?? []).map((s) => [s.id, `${s.code} • ${s.name}`]))}
              onValueChange={(value) => setSupplierId(String(value))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(suppliers ?? []).map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.code} • {supplier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Destination location</Label>
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
            <Label htmlFor="po-currency">Currency</Label>
            <Input id="po-currency" value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold text-card-foreground">Line items</CardTitle>
          <Button variant="outline" size="sm" onClick={addLine}>
            <Plus className="h-4 w-4" />
            Add line
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((line) => (
            <div key={line.key} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_120px_160px_auto]">
              <Select
                value={line.productVariantId || undefined}
                items={Object.fromEntries((variants ?? []).map((v) => [v.id, `${v.sku} • ${v.variantName}`]))}
                onValueChange={(value) => selectVariant(line.key, String(value))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(variants ?? []).map((variant) => (
                    <SelectItem key={variant.id} value={variant.id}>
                      {variant.sku} • {variant.variantName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={1}
                value={line.qty}
                onChange={(event) => updateLine(line.key, { qty: event.target.value })}
                aria-label="Ordered quantity"
              />
              <Input
                value={line.unitCost}
                placeholder="unit cost"
                onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
                aria-label="Unit cost"
              />
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
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="border-border bg-card text-card-foreground lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-card-foreground">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Input value={notes} placeholder="Procurement notes…" onChange={(event) => setNotes(event.target.value)} />
          </CardContent>
        </Card>

        <Card className="border-border bg-card text-card-foreground">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-card-foreground">Totals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Tax</span>
              <Input className="w-28" value={tax} onChange={(event) => setTax(event.target.value)} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Shipping</span>
              <Input className="w-28" value={shipping} onChange={(event) => setShipping(event.target.value)} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Subtotal</span>
              <span className="font-mono text-xs tabular-nums">{formatMoney(subtotalCents, currency)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-xs font-medium">Total</span>
              <span className="font-mono text-sm font-bold tabular-nums">{formatMoney(totalCents, currency)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {createMutation.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not save purchase order</AlertTitle>
          <AlertDescription>{createMutation.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" disabled={createMutation.isPending} onClick={() => createMutation.mutate({ submit: false })}>
          {createMutation.isPending ? 'Saving…' : 'Save as Draft'}
        </Button>
        <Button disabled={createMutation.isPending} onClick={() => createMutation.mutate({ submit: true })}>
          Submit for Manager Approval
        </Button>
      </div>
    </div>
  );
}
