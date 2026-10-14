'use client';

/** Dense Product Catalog screen (Doc 4 §4.5.3). */
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState, type ChangeEvent } from 'react';
import {
  ProductCatalogTable,
  type CatalogRow,
  type ReorderStatus,
} from '@/components/catalog/product-catalog-table';
import { ProductDetailDrawer } from '@/components/catalog/product-detail-drawer';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdaptivePolling } from '@/hooks/use-adaptive-polling';
import { apiClient } from '@/lib/api-client';

const CATEGORY_LABELS: Record<string, string> = {
  ALL: 'All Categories',
  GPUs: 'GPUs',
  CPUs: 'CPUs',
  Memory: 'Memory',
  Storage: 'Storage',
  Motherboards: 'Motherboards',
  'Power Supplies': 'Power Supplies',
};

const REORDER_TABS: ReadonlyArray<{ value: ReorderStatus; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'IN_STOCK', label: 'In Stock' },
  { value: 'LOW_STOCK', label: 'Low Stock' },
  { value: 'OUT_OF_STOCK', label: 'Out of Stock' },
  { value: 'DISCONTINUED', label: 'Discontinued' },
];

interface CatalogResponse {
  rows: CatalogRow[];
  viewerRole: string;
  total: number;
}

interface SupplierOption {
  id: string;
  code: string;
  name: string;
}

export default function CatalogPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locationId = searchParams.get('locationId');

  useAdaptivePolling({ mode: 'idle' });

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [supplierId, setSupplierId] = useState('ALL');
  const [reorderStatus, setReorderStatus] = useState<ReorderStatus>('ALL');
  const [drawerVariantId, setDrawerVariantId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearchChange(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value;
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 300);
  }

  const { data, isLoading, isError } = useQuery<CatalogResponse>({
    queryKey: ['products', locationId ?? 'ALL', debouncedSearch, category, supplierId, reorderStatus],
    queryFn: async (): Promise<CatalogResponse> => {
      const params = new URLSearchParams();
      if (locationId) params.set('locationId', locationId);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (category !== 'ALL') params.set('category', category);
      if (supplierId !== 'ALL') params.set('supplierId', supplierId);
      if (reorderStatus !== 'ALL') params.set('reorderStatus', reorderStatus);
      const res = await apiClient<CatalogRow[]>(`/api/v1/products?${params.toString()}`);
      if (!res.ok) throw new Error(res.error.message);
      const meta = res.meta as { viewerRole?: string; total?: number };
      return { rows: res.data, viewerRole: meta.viewerRole ?? 'AUDITOR', total: meta.total ?? res.data.length };
    },
  });

  const { data: suppliers } = useQuery<SupplierOption[]>({
    queryKey: ['suppliers'],
    queryFn: async (): Promise<SupplierOption[]> => {
      const res = await apiClient<SupplierOption[]>('/api/v1/suppliers');
      return res.ok ? res.data : [];
    },
  });

  const canEditPricing = data?.viewerRole === 'OWNER' || data?.viewerRole === 'MANAGER';

  function openDrawer(row: CatalogRow): void {
    setDrawerVariantId(row.id);
    setDrawerOpen(true);
  }

  const supplierItems: Record<string, string> = {
    ALL: 'All Suppliers',
    ...Object.fromEntries((suppliers ?? []).map((supplier) => [supplier.id, `${supplier.code} • ${supplier.name}`])),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Product Catalog</h1>
          <p className="text-sm text-muted-foreground">
            {data ? `${data.total} variants` : 'Loading catalog…'} across locations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => window.open('/api/v1/products/export', '_blank')}>
            Export CSV
          </Button>
          <Button variant="secondary" onClick={() => router.push('/catalog/import')}>
            Bulk CSV Import
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={handleSearchChange}
          placeholder="Search SKU, name or barcode…"
          className="w-full sm:w-72"
        />
        <Select value={category} items={CATEGORY_LABELS} onValueChange={(value) => setCategory(String(value))}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={supplierId} items={supplierItems} onValueChange={(value) => setSupplierId(String(value))}>
          <SelectTrigger className="w-[240px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(supplierItems).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tabs value={reorderStatus} onValueChange={(value) => setReorderStatus(String(value) as ReorderStatus)}>
          <TabsList>
            {REORDER_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load catalog</AlertTitle>
          <AlertDescription>The catalog is temporarily unavailable.</AlertDescription>
        </Alert>
      ) : null}

      {isLoading || !data ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <ProductCatalogTable
          rows={data.rows}
          canEditPricing={canEditPricing}
          onInspect={openDrawer}
          onEditMetadata={openDrawer}
        />
      )}

      <p className="text-xs text-muted-foreground">
        Need to add a SKU? Use{' '}
        <Link href="/catalog/import" className="text-primary underline-offset-4 hover:underline">
          Bulk CSV Import
        </Link>
        .
      </p>

      <ProductDetailDrawer
        variantId={drawerVariantId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        canEditPricing={canEditPricing}
      />
    </div>
  );
}
