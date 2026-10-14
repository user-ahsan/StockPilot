'use client';

/** Valuation by hardware category — Recharts donut with a custom popover tooltip. */
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/money';

export interface CategoryValuation {
  category: string;
  valuationCents: number;
  shareBps: number;
  totalUnits: number;
  skuCount: number;
  lowStockSkuCount: number;
  currency: string;
}

export interface ValuationCategoryChartProps {
  data: CategoryValuation[];
  currency: string;
}

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

interface TooltipInjected {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: CategoryValuation }>;
}

function CategoryTooltip({ active, payload }: TooltipInjected) {
  const slice = payload?.[0]?.payload;
  if (!active || !slice) return null;
  return (
    <div className="rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md">
      <p className="mb-2 font-medium">{slice.category}</p>
      <dl className="space-y-0.5">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Valuation</dt>
          <dd className="font-mono tabular-nums">{formatMoney(slice.valuationCents, slice.currency)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Share</dt>
          <dd className="font-mono tabular-nums">{(slice.shareBps / 100).toFixed(1)}%</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Units</dt>
          <dd className="font-mono tabular-nums">{slice.totalUnits}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Low-stock SKUs</dt>
          <dd className="font-mono tabular-nums">{slice.lowStockSkuCount}</dd>
        </div>
      </dl>
    </div>
  );
}

export function ValuationCategoryChart({ data, currency }: ValuationCategoryChartProps) {
  return (
    <Card className="border-border bg-card text-card-foreground">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-card-foreground">
          Valuation by Category
        </CardTitle>
        <p className="text-xs text-muted-foreground">Capital distribution, in {currency}</p>
      </CardHeader>
      <CardContent>
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip content={<CategoryTooltip />} />
              <Pie
                data={data}
                dataKey="valuationCents"
                nameKey="category"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                stroke="var(--background)"
              >
                {data.map((slice, index) => (
                  <Cell key={slice.category} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
