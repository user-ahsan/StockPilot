'use client';

/** Supplier directory + Add Supplier dialog (Doc 1 Module B). */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
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
import { useIdempotentMutation } from '@/hooks/use-idempotent-mutation';
import { apiClient } from '@/lib/api-client';

interface Supplier {
  id: string;
  code: string;
  name: string;
  contactName: string;
  orderEmail: string;
  phone: string | null;
  currency: string;
  leadTimeDays: number;
  isActive: boolean;
}

interface SupplierForm {
  code: string;
  name: string;
  contactName: string;
  orderEmail: string;
  currency: string;
  leadTimeDays: number;
}

const EMPTY_FORM: SupplierForm = {
  code: '',
  name: '',
  contactName: '',
  orderEmail: '',
  currency: 'USD',
  leadTimeDays: 7,
};

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM);

  const { data, isLoading, isError } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: async (): Promise<Supplier[]> => {
      const res = await apiClient<Supplier[]>('/api/v1/suppliers');
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const createMutation = useIdempotentMutation<Supplier, Error, SupplierForm>(
    async (variables, idempotencyKey) => {
      const res = await apiClient<Supplier>('/api/v1/suppliers', {
        method: 'POST',
        body: variables,
        idempotencyKey,
      });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    {
      onSuccess: () => {
        toast.success('Supplier added');
        setOpen(false);
        setForm(EMPTY_FORM);
        void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      },
      onError: (error) => toast.error(error.message),
    },
  );

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    createMutation.mutate(form);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Suppliers</h1>
          <p className="text-sm text-muted-foreground">Hardware &amp; wholesale vendors and lead times.</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          Add Supplier
        </Button>
      </div>

      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load suppliers</AlertTitle>
          <AlertDescription>The supplier directory is temporarily unavailable.</AlertDescription>
        </Alert>
      ) : null}

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-card-foreground">Directory</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Code</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Supplier</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Contact</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Order Email</TableHead>
                  <TableHead className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">Lead Time</TableHead>
                  <TableHead className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">Currency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((supplier) => (
                  <TableRow key={supplier.id} className="h-10">
                    <TableCell className="font-mono text-xs font-medium tabular-nums">{supplier.code}</TableCell>
                    <TableCell className="text-sm">{supplier.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{supplier.contactName}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">{supplier.orderEmail}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary" className="font-mono tabular-nums">{supplier.leadTimeDays}d</Badge>
                    </TableCell>
                    <TableCell className="text-center font-mono text-xs tabular-nums">{supplier.currency}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Supplier</DialogTitle>
            <DialogDescription>Register a new vendor for procurement.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="supplier-code">Code</Label>
                <Input
                  id="supplier-code"
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
                  placeholder="SUP-NEW"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplier-currency">Currency</Label>
                <Input
                  id="supplier-currency"
                  value={form.currency}
                  onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
                  maxLength={3}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-name">Name</Label>
              <Input id="supplier-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-contact">Contact name</Label>
              <Input id="supplier-contact" value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-email">Order email</Label>
              <Input id="supplier-email" type="email" value={form.orderEmail} onChange={(event) => setForm({ ...form, orderEmail: event.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-lead">Lead time (days)</Label>
              <Input
                id="supplier-lead"
                type="number"
                min={0}
                value={form.leadTimeDays}
                onChange={(event) => setForm({ ...form, leadTimeDays: Number(event.target.value) })}
                required
              />
            </div>
            <DialogFooter showCloseButton>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Saving…' : 'Save supplier'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
