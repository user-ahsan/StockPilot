'use client';

/** Stock adjustments log + suspicious review queue (Doc 4 §4.5.5). */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIdempotentMutation } from '@/hooks/use-idempotent-mutation';
import { apiClient } from '@/lib/api-client';
import { formatMoney } from '@/lib/money';

interface AdjustmentRow {
  id: string;
  adjustmentNumber: string;
  createdAt: string;
  sku?: string;
  variantName?: string;
  locationCode?: string;
  quantityDelta: number;
  totalImpactCents: number;
  currency: string;
  reasonCode: string;
  status: string;
  isSuspicious: boolean;
  suspiciousTriggerReasons: string[];
  actorMemberId: string;
}

export default function AdjustmentsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('all');
  const [selected, setSelected] = useState<AdjustmentRow | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');

  const { data, isLoading, isError } = useQuery<AdjustmentRow[]>({
    queryKey: ['stock-adjustments', tab],
    queryFn: async (): Promise<AdjustmentRow[]> => {
      const params = new URLSearchParams();
      if (tab === 'suspicious') params.set('onlySuspicious', 'true');
      const res = await apiClient<AdjustmentRow[]>(`/api/v1/stock-adjustments?${params.toString()}`);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const reviewMutation = useIdempotentMutation<unknown, Error, { adjustmentId: string; decision: 'APPROVE' | 'REJECT'; reviewNotes: string }>(
    async (variables, idempotencyKey) => {
      const res = await apiClient(`/api/v1/stock-adjustments/${variables.adjustmentId}/review`, {
        method: 'POST',
        idempotencyKey,
        body: { decision: variables.decision, reviewNotes: variables.reviewNotes },
      });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    {
      onSuccess: (_result, variables) => {
        toast.success(variables.decision === 'APPROVE' ? 'Adjustment approved' : 'Adjustment rejected & reversed');
        setSelected(null);
        setReviewNotes('');
        void queryClient.invalidateQueries({ queryKey: ['stock-adjustments'] });
      },
      onError: (error) => toast.error(error.message),
    },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Stock Adjustments</h1>
        <p className="text-sm text-muted-foreground">Controlled shrinkage, damage and cycle-count corrections.</p>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList>
          <TabsTrigger value="all">All Adjustments</TabsTrigger>
          <TabsTrigger value="suspicious">
            Suspicious Review Queue ({data?.filter((row) => row.isSuspicious && row.status === 'PENDING_APPROVAL').length ?? 0})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load adjustments</AlertTitle>
          <AlertDescription>The adjustment ledger is temporarily unavailable.</AlertDescription>
        </Alert>
      ) : null}

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-card-foreground">Ledger</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <div className="space-y-2">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Adj #</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">SKU</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Location</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Delta</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Impact</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Reason</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Status</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      No adjustments recorded.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((row) => (
                    <TableRow key={row.id} className="h-10">
                      <TableCell className="font-mono text-xs tabular-nums">{row.adjustmentNumber}</TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{row.sku ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{row.locationCode ?? '—'}</TableCell>
                      <TableCell className={`text-right font-mono text-xs tabular-nums ${row.quantityDelta < 0 ? 'text-destructive' : 'text-foreground'}`}>
                        {row.quantityDelta > 0 ? `+${row.quantityDelta}` : row.quantityDelta}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatMoney(row.totalImpactCents, row.currency)}
                      </TableCell>
                      <TableCell className="text-xs">{row.reasonCode.replace(/_/g, ' ')}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant={row.status === 'PENDING_APPROVAL' ? 'destructive' : 'secondary'}>
                            {row.status.replace(/_/g, ' ')}
                          </Badge>
                          {row.isSuspicious
                            ? row.suspiciousTriggerReasons.map((trigger) => (
                                <Badge key={trigger} variant="outline">
                                  {trigger.replace(/_/g, ' ')}
                                </Badge>
                              ))
                            : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {row.isSuspicious && row.status === 'PENDING_APPROVAL' ? (
                          <Button variant="ghost" size="sm" onClick={() => setSelected(row)}>
                            Review
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={selected !== null} onOpenChange={(open) => (!open ? setSelected(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review {selected?.adjustmentNumber}</DialogTitle>
            <DialogDescription>
              Rejecting posts a compensating reversal so inventory is restored atomically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="review-notes">Review notes (min 10 chars)</Label>
              <Input id="review-notes" value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} />
            </div>
            <DialogFooter showCloseButton>
              <Button
                type="button"
                variant="destructive"
                disabled={reviewMutation.isPending}
                onClick={() => selected && reviewMutation.mutate({ adjustmentId: selected.id, decision: 'REJECT', reviewNotes })}
              >
                Reject &amp; Reverse
              </Button>
              <Button
                type="button"
                disabled={reviewMutation.isPending}
                onClick={() => selected && reviewMutation.mutate({ adjustmentId: selected.id, decision: 'APPROVE', reviewNotes })}
              >
                Approve
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
