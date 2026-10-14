'use client';

/** Immutable forensic audit trail explorer (Doc 3 §3.6). */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient } from '@/lib/api-client';
import { escapeCsvCellForExport } from '@/lib/validators/csv.schema';

interface AuditRow {
  id: number;
  createdAt: string;
  actorMemberId: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  correlationId: string;
  beforeState: unknown;
  afterState: unknown;
}

const ACTIONS = [
  'ALL',
  'PO_STOCK_RECEIVED',
  'SO_CONFIRMED_AND_RESERVED',
  'SO_FULFILLED',
  'STOCK_ADJUSTMENT_RECORDED',
  'SUSPICIOUS_ADJUSTMENT_FLAGGED',
  'SUSPICIOUS_ADJUSTMENT_REVIEWED',
  'PRODUCT_PRICE_UPDATED',
  'UNAUTHORIZED_ACTION_BLOCKED',
  'AUDIT_BULK_CATALOG_IMPORT',
];
const ACTION_LABELS: Record<string, string> = Object.fromEntries(ACTIONS.map((a) => [a, a === 'ALL' ? 'All actions' : a.replace(/_/g, ' ')]));

const ENTITY_TYPES = ['ALL', 'purchase_orders', 'sales_orders', 'stock_adjustments', 'product_variants', 'api_route'];
const ENTITY_LABELS: Record<string, string> = Object.fromEntries(ENTITY_TYPES.map((e) => [e, e === 'ALL' ? 'All entities' : e]));

function renderJson(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function AuditLogsPage() {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('ALL');
  const [entityType, setEntityType] = useState('ALL');
  const [inspecting, setInspecting] = useState<AuditRow | null>(null);

  const { data, isLoading } = useQuery<AuditRow[]>({
    queryKey: ['audit-logs', action, entityType],
    queryFn: async (): Promise<AuditRow[]> => {
      const params = new URLSearchParams({ limit: '100' });
      if (action !== 'ALL') params.set('action', action);
      if (entityType !== 'ALL') params.set('entityType', entityType);
      const res = await apiClient<AuditRow[]>(`/api/v1/audit-logs?${params.toString()}`);
      return res.ok ? res.data : [];
    },
  });

  const rows = (data ?? []).filter((row) => {
    if (!search.trim()) return true;
    const term = search.trim().toLowerCase();
    return (
      row.entityId.toLowerCase().includes(term) ||
      row.actorMemberId.toLowerCase().includes(term) ||
      (row.reason ?? '').toLowerCase().includes(term)
    );
  });

  function exportCsv(): void {
    const header = ['audit_id', 'created_at', 'actor', 'role', 'action', 'entity_type', 'entity_id', 'reason', 'correlation_id'];
    const body = rows.map((row) =>
      [row.id, row.createdAt, row.actorMemberId, row.actorRole, row.action, row.entityType, row.entityId, row.reason ?? '', row.correlationId]
        .map((cell) => escapeCsvCellForExport(cell))
        .join(','),
    );
    const csv = [header.join(','), ...body].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'stockpilot-audit-trail.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Audit Trail</h1>
          <p className="text-sm text-muted-foreground">Append-only forensic log — records can never be altered or deleted.</p>
        </div>
        <Button variant="outline" onClick={exportCsv}>Export Audit Trail CSV</Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search entity ID, actor or reason…" className="w-full sm:w-72" />
        <Select value={action} items={ACTION_LABELS} onValueChange={(value) => setAction(String(value))}>
          <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ACTIONS.map((entry) => (<SelectItem key={entry} value={entry}>{ACTION_LABELS[entry]}</SelectItem>))}
          </SelectContent>
        </Select>
        <Select value={entityType} items={ENTITY_LABELS} onValueChange={(value) => setEntityType(String(value))}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ENTITY_TYPES.map((entry) => (<SelectItem key={entry} value={entry}>{ENTITY_LABELS[entry]}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-2"><CardTitle className="text-base font-semibold text-card-foreground">Forensic entries</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Audit #</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Timestamp</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Actor</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Action</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Entity</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Reason</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Correlation</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Diff</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">No audit entries.</TableCell></TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id} className="h-10">
                      <TableCell className="font-mono text-xs tabular-nums">#{row.id}</TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{String(row.createdAt).slice(0, 19).replace('T', ' ')}</TableCell>
                      <TableCell className="text-xs">
                        <span className="block font-mono tabular-nums">{row.actorMemberId.slice(0, 8)}…</span>
                        <Badge variant="outline">{row.actorRole.replace(/_/g, ' ')}</Badge>
                      </TableCell>
                      <TableCell><Badge variant={row.action.includes('UNAUTHORIZED') ? 'destructive' : 'secondary'}>{row.action.replace(/_/g, ' ')}</Badge></TableCell>
                      <TableCell className="text-xs">
                        <span className="block">{row.entityType}</span>
                        <span className="block font-mono text-muted-foreground tabular-nums">{row.entityId.slice(0, 12)}</span>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">{row.reason ?? '—'}</TableCell>
                      <TableCell className="font-mono text-[11px] tabular-nums text-muted-foreground">{row.correlationId}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setInspecting(row)}>Inspect JSON Diff</Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={inspecting !== null} onOpenChange={(open) => (!open ? setInspecting(null) : undefined)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Audit #{inspecting?.id} · {inspecting?.action.replace(/_/g, ' ')}</DialogTitle>
            <DialogDescription>{inspecting?.entityType} · {inspecting?.entityId}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">before_state</p>
              <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] tabular-nums">{renderJson(inspecting?.beforeState)}</pre>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">after_state</p>
              <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] tabular-nums">{renderJson(inspecting?.afterState)}</pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
