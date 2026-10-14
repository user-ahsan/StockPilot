'use client';

/**
 * Dense product catalog table (Doc 4 §4.5.3).
 *
 * TanStack Table v9 shipped here relocated the v8-style API to the `legacy`
 * subpath, so `useLegacyTable` + `LegacyColumnDef` are used (v9's new
 * `useTable` feature-slot API is a separate migration). Columns are declared as
 * `LegacyColumnDef<CatalogRow>[]` rather than via `legacyCreateColumnHelper`,
 * because the helper's per-column `TValue` inference trips a variance error when
 * the table expects `TValue = unknown`.
 */
import { flexRender, type SortingState } from '@tanstack/react-table';
import {
  getCoreRowModel,
  getSortedRowModel,
  useLegacyTable,
  type LegacyColumnDef,
} from '@tanstack/react-table/legacy';
import { Copy, MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatMoney } from '@/lib/money';

export type ReorderStatus = 'ALL' | 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'DISCONTINUED';

export interface CatalogRow {
  id: string;
  sku: string;
  barcodeUpc: string | null;
  variantName: string;
  productName: string;
  brand: string;
  category: string;
  attributes: Record<string, string>;
  currency: string;
  imageUrl: string | null;
  unitCostCents: number | null;
  sellingPriceCents: number;
  marginBps: number | null;
  reorderPoint: number;
  isActive: boolean;
  supplierId: string;
  supplierName: string;
  leadTimeDays: number;
  onHandQty: number;
  reservedQty: number;
  availableQty: number;
  reorderStatus: ReorderStatus;
  updatedAt: string;
}

export interface ProductCatalogTableProps {
  rows: CatalogRow[];
  canEditPricing: boolean;
  onInspect: (row: CatalogRow) => void;
  onEditMetadata: (row: CatalogRow) => void;
}

function statusVariant(status: ReorderStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'IN_STOCK') return 'secondary';
  if (status === 'LOW_STOCK') return 'default';
  if (status === 'OUT_OF_STOCK') return 'destructive';
  return 'outline';
}

async function copySku(sku: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(sku);
    toast.success(`Copied ${sku}`);
  } catch {
    toast.error('Clipboard unavailable');
  }
}

export function ProductCatalogTable({ rows, canEditPricing, onInspect, onEditMetadata }: ProductCatalogTableProps) {
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns: LegacyColumnDef<CatalogRow>[] = [
    {
      id: 'image',
      header: () => <span className="sr-only">Image</span>,
      cell: () => <div className="h-8 w-8 rounded-md bg-muted" aria-hidden />,
    },
    {
      id: 'sku',
      accessorKey: 'sku',
      header: 'SKU',
      cell: (info) => {
        const row = info.row.original;
        return (
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger className="cursor-help border-0 bg-transparent p-0 font-mono text-xs font-medium tabular-nums">
                {row.sku}
              </TooltipTrigger>
              <TooltipContent className="font-mono tabular-nums">
                {row.barcodeUpc ? `UPC ${row.barcodeUpc}` : 'No barcode'}
              </TooltipContent>
            </Tooltip>
            <Button variant="ghost" size="icon-sm" aria-label={`Copy ${row.sku}`} onClick={() => void copySku(row.sku)}>
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        );
      },
    },
    {
      id: 'variantName',
      accessorKey: 'variantName',
      header: 'Product & Variant',
      cell: (info) => {
        const row = info.row.original;
        const attributes = Object.entries(row.attributes ?? {}).slice(0, 3);
        return (
          <div className="space-y-1">
            <span className="block text-sm text-foreground">{row.productName}</span>
            <span className="block text-xs text-muted-foreground">{row.variantName}</span>
            {attributes.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {attributes.map(([key, value]) => (
                  <Badge key={key} variant="outline">
                    {value}
                  </Badge>
                ))}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'supplierName',
      accessorKey: 'supplierName',
      header: 'Supplier',
      cell: (info) => {
        const row = info.row.original;
        return (
          <div className="flex items-center gap-2">
            <span className="text-xs">{row.supplierName}</span>
            <Badge variant="secondary" className="font-mono tabular-nums">
              {row.leadTimeDays}d
            </Badge>
          </div>
        );
      },
    },
    {
      id: 'unitCostCents',
      accessorFn: (row) => row.unitCostCents,
      header: 'Unit Cost',
      cell: (info) => {
        const row = info.row.original;
        return (
          <span className="block text-right font-mono text-xs tabular-nums">
            {row.unitCostCents === null ? '—' : formatMoney(row.unitCostCents, row.currency)}
          </span>
        );
      },
    },
    {
      id: 'sellingPriceCents',
      accessorKey: 'sellingPriceCents',
      header: 'Selling Price',
      cell: (info) => {
        const row = info.row.original;
        return (
          <div className="text-right">
            <span className="block font-mono text-xs tabular-nums">
              {formatMoney(row.sellingPriceCents, row.currency)}
            </span>
            {row.marginBps !== null ? (
              <Badge variant="outline" className="mt-0.5 font-mono tabular-nums">
                {(row.marginBps / 100).toFixed(1)}%
              </Badge>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'availableQty',
      accessorKey: 'availableQty',
      header: 'On Hand / Reserved / Available',
      cell: (info) => {
        const row = info.row.original;
        return (
          <div className="text-right">
            <Tooltip>
              <TooltipTrigger className="cursor-help border-0 bg-transparent p-0 font-mono text-sm font-bold tabular-nums">
                {row.availableQty}
              </TooltipTrigger>
              <TooltipContent className="font-mono tabular-nums">
                {row.onHandQty} on hand − {row.reservedQty} reserved
              </TooltipContent>
            </Tooltip>
            <span className="block font-mono text-[10px] tabular-nums text-muted-foreground">
              {row.onHandQty} / {row.reservedQty}
            </span>
          </div>
        );
      },
    },
    {
      id: 'reorderStatus',
      accessorKey: 'reorderStatus',
      header: 'Reorder Status',
      cell: (info) => {
        const row = info.row.original;
        return (
          <div className="text-center">
            <Badge variant={statusVariant(row.reorderStatus)}>{row.reorderStatus.replace(/_/g, ' ')}</Badge>
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: (info) => {
        const row = info.row.original;
        return (
          <div className="text-right">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.sku}`} />}>
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{row.sku}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onInspect(row)}>Inspect SKU Ledger</DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push(`/catalog/${row.id}`)}>View Full Detail</DropdownMenuItem>
                {canEditPricing ? (
                  <DropdownMenuItem onClick={() => onEditMetadata(row)}>Edit Metadata / Pricing</DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push('/adjustments/new')}>Record Adjustment</DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/purchase-orders/new')}>Draft PO</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  const table = useLegacyTable<CatalogRow>({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="bg-muted/50">
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-10 text-center text-sm text-muted-foreground">
                No product variants match the current filters.
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} className="h-10">
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
