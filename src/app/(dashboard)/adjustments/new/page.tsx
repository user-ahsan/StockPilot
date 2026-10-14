'use client';

/** Controlled adjustment form with anomaly preview (Doc 4 §4.5.5). */
import { useQuery } from '@tanstack/react-query';
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
import { Textarea } from '@/components/ui/textarea';
import { useIdempotentMutation } from '@/hooks/use-idempotent-mutation';
import { apiClient } from '@/lib/api-client';
import { formatMoney } from '@/lib/money';

const LOCATIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'a0000000-0000-4000-8000-000000000101', label: 'WH-CENTRAL • Central Warehouse' },
  { id: 'a0000000-0000-4000-8000-000000000102', label: 'STORE-MAIN • Main Showroom' },
  { id: 'a0000000-0000-4000-8000-000000000103', label: 'STORE-DOWNTOWN • Downtown Branch' },
];
const LOCATION_LABELS: Record<string, string> = Object.fromEntries(LOCATIONS.map((l) => [l.id, l.label]));

const REASON_CODES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'DAMAGED_IN_TRANSIT', label: 'Damaged in transit' },
  { value: 'WAREHOUSE_BREAKAGE', label: 'Warehouse breakage' },
  { value: 'THEFT_SHRINKAGE', label: 'Theft / shrinkage' },
  { value: 'CYCLE_COUNT_SURPLUS', label: 'Cycle count surplus' },
  { value: 'CYCLE_COUNT_DEFICIT', label: 'Cycle count deficit' },
  { value: 'WARRANTY_RETURN', label: 'Warranty return' },
  { value: 'EXPIRED_OBSOLETE', label: 'Expired / obsolete' },
];
const REASON_LABELS: Record<string, string> = Object.fromEntries(REASON_CODES.map((r) => [r.value, r.label]));

interface VariantOption {
  id: string;
  sku: string;
  variantName: string;
  unitCostCents: number | null;
  availableQty: number;
  currency: string;
}

export default function NewAdjustmentPage() {
  const router = useRouter();
  const [locationId, setLocationId] = useState(LOCATIONS[0].id);
  const [variantId, setVariantId] = useState('');
  const [direction, setDirection] = useState('deduct');
  const [quantity, setQuantity] = useState('1');
  const [reasonCode, setReasonCode] = useState('WAREHOUSE_BREAKAGE');
  const [reasonNotes, setReasonNotes] = useState('');

  const { data: variants } = useQuery<VariantOption[]>({
    queryKey: ['products', locationId, 'adjust'],
    queryFn: async () => {
      const res = await apiClient<VariantOption[]>(`/api/v1/products?pageSize=200&locationId=${locationId}`);
      return res.ok ? res.data : [];
    },
  });

  const createMutation = useIdempotentMutation<unknown, Error, void>(
    async (_variables, idempotencyKey) => {
      const signed = direction === 'deduct' ? -Math.abs(Number(quantity)) : Math.abs(Number(quantity));
      const res = await apiClient('/api/v1/stock-adjustments', {
        method: 'POST',
        idempotencyKey,
        body: { locationId, productVariantId: variantId, quantityDelta: signed, reasonCode, reasonNotes: reasonNotes.trim() },
      });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    {
      onSuccess: () => {
        toast.success('Adjustment recorded');
        router.push('/adjustments');
      },
      onError: (error) => toast.error(error.message),
    },
  );

  const variant = variants?.find((entry) => entry.id === variantId);
  const signedDelta = direction === 'deduct' ? -Math.abs(Number(quantity) || 0) : Math.abs(Number(quantity) || 0);
  const before = variant?.availableQty ?? 0;
  const after = before + signedDelta;
  const impactCents = Math.abs(signedDelta) * (variant?.unitCostCents ?? 0);
  const noteLength = reasonNotes.trim().length;

  const exceedsValue = impactCents >= 50_000;
  const exceedsPct = before > 0 && (Math.abs(signedDelta) * 10_000) / before > 1_000;
  const willFlag = exceedsValue || exceedsPct;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">New Stock Adjustment</h1>
        <p className="text-sm text-muted-foreground">Every adjustment requires an actor, a reason code and a detailed explanation.</p>
      </div>

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-card-foreground">Adjustment</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Location</Label>
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
            <Label>SKU</Label>
            <Select
              value={variantId || undefined}
              items={Object.fromEntries((variants ?? []).map((v) => [v.id, `${v.sku} • ${v.variantName}`]))}
              onValueChange={(value) => setVariantId(String(value))}
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
          </div>
          <div className="space-y-2">
            <Label>Direction</Label>
            <Select
              value={direction}
              items={{ deduct: 'Deduct (shrinkage / damage)', add: 'Add surplus' }}
              onValueChange={(value) => setDirection(String(value))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="deduct">Deduct (shrinkage / damage)</SelectItem>
                <SelectItem value="add">Add surplus</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="adj-qty">Quantity</Label>
            <Input id="adj-qty" type="number" min={1} value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Reason code</Label>
            <Select value={reasonCode} items={REASON_LABELS} onValueChange={(value) => setReasonCode(String(value))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASON_CODES.map((reason) => (
                  <SelectItem key={reason.value} value={reason.value}>
                    {reason.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="adj-notes">Detailed explanation (min 15 chars)</Label>
            <Textarea id="adj-notes" value={reasonNotes} onChange={(event) => setReasonNotes(event.target.value)} rows={3} />
            <p className={`text-xs ${noteLength >= 15 ? 'text-muted-foreground' : 'text-destructive'}`}>{noteLength}/15</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-card-foreground">Preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="rounded-md bg-muted p-4 font-mono text-sm tabular-nums">
            Available {before} → {signedDelta > 0 ? `+${signedDelta}` : signedDelta} → {after}
          </div>
          <p className="font-mono text-xs tabular-nums text-muted-foreground">
            Financial impact {formatMoney(impactCents, variant?.currency ?? 'USD')}
          </p>
        </CardContent>
      </Card>

      {willFlag ? (
        <Alert>
          <AlertTitle>This adjustment will be flagged for Manager review</AlertTitle>
          <AlertDescription>
            {exceedsValue ? 'Impact ≥ USD $500.00. ' : ''}
            {exceedsPct ? 'Quantity exceeds 10% of current stock. ' : ''}
            It will enter the Suspicious Review Queue as PENDING_APPROVAL.
          </AlertDescription>
        </Alert>
      ) : null}

      {createMutation.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not record adjustment</AlertTitle>
          <AlertDescription>{createMutation.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        disabled={createMutation.isPending || !variantId || noteLength < 15 || signedDelta === 0}
        onClick={() => createMutation.mutate()}
      >
        {createMutation.isPending ? 'Submitting…' : 'Submit Adjustment'}
      </Button>
    </div>
  );
}
