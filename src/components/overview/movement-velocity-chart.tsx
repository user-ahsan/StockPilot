'use client';

/** Stock movement velocity — Recharts ComposedChart with a custom popover tooltip. */
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/money';

export interface VelocityBucket {
  date: string;
  inboundUnits: number;
  inboundValueCents: number;
  outboundUnits: number;
  outboundValueCents: number;
  adjustmentUnits: number;
  adjustmentValueCents: number;
  netDeltaUnits: number;
  topMovingSku: string | null;
  currency: string;
}

export interface MovementVelocityChartProps {
  series: VelocityBucket[];
  currency: string;
}

interface TooltipInjected {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: VelocityBucket }>;
}

function VelocityTooltip({ active, payload }: TooltipInjected) {
  const bucket = payload?.[0]?.payload;
  if (!active || !bucket) return null;
  const signed = bucket.netDeltaUnits >= 0 ? `+${bucket.netDeltaUnits}` : `${bucket.netDeltaUnits}`;
  return (
    <div className="rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md">
      <p className="mb-2 font-medium">{bucket.date}</p>
      <dl className="space-y-0.5">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Inbound</dt>
          <dd className="font-mono tabular-nums">
            +{bucket.inboundUnits} units / {formatMoney(bucket.inboundValueCents, bucket.currency)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Outbound</dt>
          <dd className="font-mono tabular-nums">
            -{bucket.outboundUnits} units / {formatMoney(bucket.outboundValueCents, bucket.currency)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Adjustments</dt>
          <dd className="font-mono tabular-nums">
            {formatMoney(-bucket.adjustmentValueCents, bucket.currency)} / {bucket.adjustmentUnits} units
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-border pt-1">
          <dt className="text-muted-foreground">Net delta</dt>
          <dd className="font-mono tabular-nums">{signed} units</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Top mover</dt>
          <dd className="font-mono tabular-nums">{bucket.topMovingSku ?? '—'}</dd>
        </div>
      </dl>
    </div>
  );
}

export function MovementVelocityChart({ series, currency }: MovementVelocityChartProps) {
  return (
    <Card className="border-border bg-card text-card-foreground lg:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-card-foreground">
          Stock Movement Velocity
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Inbound vs outbound units and shrinkage, in {currency}
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <Tooltip content={<VelocityTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="inboundUnits" name="Inbound" fill="var(--chart-1)" radius={[2, 2, 0, 0]} />
              <Bar dataKey="outboundUnits" name="Outbound" fill="var(--chart-2)" radius={[2, 2, 0, 0]} />
              <Bar dataKey="adjustmentUnits" name="Shrinkage" fill="var(--destructive)" radius={[2, 2, 0, 0]} />
              <Line
                type="monotone"
                dataKey="netDeltaUnits"
                name="Net delta"
                stroke="var(--chart-4)"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
