'use client';

/** Live 25-row ledger feed (Doc 4 §4.5.2). */
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface RecentMovement {
  id: number;
  createdAt: string;
  sku: string;
  variantName: string;
  locationCode: string;
  locationName: string;
  movementType: string;
  quantityDelta: number;
  balanceBefore: number;
  balanceAfter: number;
  unitCostCents: number;
  currency: string;
  referenceType: string;
  referenceId: string;
  actorName: string;
  actorRole: string;
}

export interface RecentMovementsTableProps {
  movements: RecentMovement[];
}

function movementBadgeVariant(type: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (type === 'PO_RECEIPT' || type === 'TRANSFER_IN') return 'default';
  if (type === 'SALE_FULFILLMENT' || type === 'SALE_RESERVATION' || type === 'SALE_RELEASE') return 'secondary';
  if (type.startsWith('ADJUSTMENT')) return 'destructive';
  return 'outline';
}

function referenceHref(type: string, id: string): string | null {
  if (type === 'PURCHASE_ORDER') return `/purchase-orders/${id}`;
  if (type === 'SALES_ORDER') return `/sales-orders/${id}`;
  if (type === 'STOCK_ADJUSTMENT') return '/adjustments';
  return null;
}

/** Deterministic, locale-free timestamp (avoids SSR/CSR mismatch). */
function formatStamp(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ');
}

export function RecentMovementsTable({ movements }: RecentMovementsTableProps) {
  return (
    <Card className="border-border bg-card text-card-foreground">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-card-foreground">
          Recent Stock Movements
        </CardTitle>
        <p className="text-xs text-muted-foreground">Latest {movements.length} immutable ledger entries</p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Timestamp
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Ledger #
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                SKU &amp; Variant
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Location
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Type
              </TableHead>
              <TableHead className="text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Delta
              </TableHead>
              <TableHead className="text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Balance
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Reference
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Actor
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                  No ledger movements yet.
                </TableCell>
              </TableRow>
            ) : (
              movements.map((movement) => {
                const href = referenceHref(movement.referenceType, movement.referenceId);
                return (
                  <TableRow key={movement.id} className="h-10">
                    <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                      {formatStamp(movement.createdAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">#{movement.id}</TableCell>
                    <TableCell>
                      <span className="block font-mono text-xs font-medium tabular-nums">
                        {movement.sku}
                      </span>
                      <span className="block text-xs text-muted-foreground">{movement.variantName}</span>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="font-mono tabular-nums">{movement.locationCode}</span>
                      <span className="block text-muted-foreground">{movement.locationName}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={movementBadgeVariant(movement.movementType)}>
                        {movement.movementType.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono text-xs tabular-nums ${
                        movement.quantityDelta < 0 ? 'text-destructive' : 'text-foreground'
                      }`}
                    >
                      {movement.quantityDelta > 0 ? `+${movement.quantityDelta}` : movement.quantityDelta}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {movement.balanceAfter}
                    </TableCell>
                    <TableCell className="text-xs">
                      {href ? (
                        <Link href={href} className="font-mono tabular-nums text-primary underline-offset-4 hover:underline">
                          {movement.referenceType.replace(/_/g, ' ')}
                        </Link>
                      ) : (
                        <span className="font-mono tabular-nums text-muted-foreground">
                          {movement.referenceType.replace(/_/g, ' ')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="block">{movement.actorName}</span>
                      <span className="block font-mono text-muted-foreground">
                        {movement.actorRole.replace(/_/g, ' ')}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
