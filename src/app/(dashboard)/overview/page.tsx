'use client';

/** Inventory Overview dashboard (Doc 4 §4.5.2, Doc 1 Module A). */
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { KpiCards, type KpiSummary } from '@/components/overview/kpi-cards';
import {
  MovementVelocityChart,
  type VelocityBucket,
} from '@/components/overview/movement-velocity-chart';
import {
  RecentMovementsTable,
  type RecentMovement,
} from '@/components/overview/recent-movements-table';
import {
  ValuationCategoryChart,
  type CategoryValuation,
} from '@/components/overview/valuation-category-chart';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface OverviewResponse {
  kpis: KpiSummary;
  velocitySeries: VelocityBucket[];
  categoryValuation: CategoryValuation[];
  recentMovements: RecentMovement[];
}

const RANGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
];

const CATEGORY_LABELS: Record<string, string> = {
  ALL: 'All Categories',
  GPUs: 'GPUs',
  CPUs: 'CPUs',
  Memory: 'Memory',
  Storage: 'Storage',
  Motherboards: 'Motherboards',
  'Power Supplies': 'Power Supplies',
};

export default function OverviewPage() {
  const searchParams = useSearchParams();
  const locationId = searchParams.get('locationId');
  const [range, setRange] = useState('30d');
  const [category, setCategory] = useState('ALL');

  const { data, isLoading, isError } = useQuery<OverviewResponse>({
    queryKey: ['overview', locationId ?? 'ALL', range, category],
    queryFn: async (): Promise<OverviewResponse> => {
      const params = new URLSearchParams();
      if (locationId) params.set('locationId', locationId);
      params.set('range', range);
      if (category !== 'ALL') params.set('category', category);
      const res = await fetch(`/api/v1/overview?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Overview request failed with status ${res.status}`);
      const body = (await res.json()) as { data: OverviewResponse };
      return body.data;
    },
  });

  const currency = data?.kpis.currency ?? 'USD';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Inventory Overview</h1>
          <p className="text-sm text-muted-foreground">
            Real-time KPIs, movement velocity and valuation across locations.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Tabs value={range} onValueChange={(value) => setRange(String(value))}>
            <TabsList>
              {RANGES.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Select
            value={category}
            items={CATEGORY_LABELS}
            onValueChange={(value) => setCategory(String(value))}
          >
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
        </div>
      </div>

      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load overview</AlertTitle>
          <AlertDescription>The inventory metrics are temporarily unavailable.</AlertDescription>
        </Alert>
      ) : null}

      {isLoading || !data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <>
          <KpiCards kpis={data.kpis} locationId={locationId} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <MovementVelocityChart series={data.velocitySeries} currency={currency} />
            <ValuationCategoryChart data={data.categoryValuation} currency={currency} />
          </div>
          <RecentMovementsTable movements={data.recentMovements} />
        </>
      )}
    </div>
  );
}
