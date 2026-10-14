'use client';

/** Bulk CSV import: upload → validate preview → idempotent commit (Doc 4 §4.5.3). */
import { Upload } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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

interface ValidRow {
  rowNumber: number;
  sku: string;
  name: string;
  brand: string;
  category: string;
  supplierCode: string;
  unitCostCents: number;
  sellingPriceCents: number;
  currency: string;
  reorderPoint: number;
  reorderQty: number;
  barcodeUpc: string | null;
}

interface InvalidRow {
  rowNumber: number;
  rawRow: Record<string, string>;
  errors: Array<{ column: string; code: string; message: string }>;
}

interface ValidationResult {
  validRows: ValidRow[];
  invalidRows: InvalidRow[];
  summary: { totalRows: number; validCount: number; invalidCount: number; duplicateSkusInFile: number };
  headerErrors: string[];
  validationToken: string;
}

const SUPPLIER_CODES = ['SUP-TECH', 'SUP-SVW', 'SUP-GPU', 'SUP-MEM', 'SUP-STOR', 'SUP-PWR'];
const TEMPLATE_CSV = [
  'sku,name,brand,category,supplier_code,unit_cost,selling_price,currency,reorder_point,reorder_qty,barcode_upc',
  'GPU-NV-4090-24G,ASUS TUF RTX 4090 24GB,ASUS,GPUs,SUP-GPU,1650.00,1899.99,USD,5,25,0194645115643',
].join('\r\n');

/** 100 rows: 85 valid + 15 deliberately invalid (injection, bad sku, negative cost, bad currency, unknown supplier). */
function buildSampleCsv(): string {
  const header =
    'sku,name,brand,category,supplier_code,unit_cost,selling_price,currency,reorder_point,reorder_qty,barcode_upc';
  const rows: string[] = [];
  for (let index = 0; index < 100; index++) {
    const rowNumber = index + 2;
    if (index % 7 === 0) {
      const variant = (index / 7) % 5;
      if (variant === 0) rows.push(`SAMPLE-${rowNumber},=CMD()|'/C calc'!A0,Acme,GPUs,SUP-GPU,10.00,20.00,USD,5,10,`);
      else if (variant === 1) rows.push(`bad sku!,Broken SKU,Acme,GPUs,SUP-GPU,10.00,20.00,USD,5,10,`);
      else if (variant === 2) rows.push(`SAMPLE-${rowNumber},Negative cost,Acme,GPUs,SUP-GPU,-45.00,20.00,USD,5,10,`);
      else if (variant === 3) rows.push(`SAMPLE-${rowNumber},Bad currency,Acme,GPUs,SUP-GPU,10.00,20.00,JPY,5,10,`);
      else rows.push(`SAMPLE-${rowNumber},Unknown supplier,Acme,GPUs,SUP-NOPE,10.00,20.00,USD,5,10,`);
      continue;
    }
    const code = SUPPLIER_CODES[index % SUPPLIER_CODES.length];
    rows.push(`SAMPLE-${String(rowNumber).padStart(4, '0')},Sample Product ${rowNumber},Acme Corp,GPUs,${code},10.00,20.00,USD,5,10,`);
  }
  return [header, ...rows].join('\r\n');
}

export default function CatalogImportPage() {
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [tab, setTab] = useState('all');

  const commitMutation = useIdempotentMutation<{ importedValidCount: number; rejectedInvalidCount: number }, Error, string>(
    async (validationToken, idempotencyKey) => {
      if (!validation) throw new Error('Nothing validated yet.');
      const res = await apiClient<{ importedValidCount: number; rejectedInvalidCount: number }>(
        '/api/v1/products/import/commit',
        {
          method: 'POST',
          idempotencyKey,
          body: {
            validRows: validation.validRows,
            validationToken,
            rejectedInvalidCount: validation.summary.invalidCount,
            totalUploaded: validation.summary.totalRows,
          },
        },
      );
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    {
      onSuccess: (result) => {
        toast.success(`Imported ${result.importedValidCount} rows (${result.rejectedInvalidCount} rejected)`);
        setValidation(null);
        setCsvText('');
        setFileName(null);
      },
      onError: (error) => toast.error(error.message),
    },
  );

  async function validate(body: string, name: string | null): Promise<void> {
    setCsvText(body);
    setFileName(name);
    setValidating(true);
    try {
      const res = await apiClient<ValidationResult>('/api/v1/products/import/validate', {
        method: 'POST',
        body: { csvText: body, fileName: name ?? undefined },
      });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      setValidation(res.data);
      setTab('all');
    } finally {
      setValidating(false);
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    await validate(await file.text(), file.name);
  }

  function downloadText(content: string, filename: string): void {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadRejected(): void {
    if (!validation) return;
    const header = 'row,sku,errors';
    const lines = validation.invalidRows.map(
      (row) => `${row.rowNumber},${row.rawRow.sku ?? ''},"${row.errors.map((error) => `${error.column}:${error.code}`).join('; ')}"`,
    );
    downloadText([header, ...lines].join('\r\n'), 'stockpilot-rejected-rows.csv');
  }

  const rowsToShow = (() => {
    if (!validation) return [];
    if (tab === 'invalid') return validation.invalidRows;
    if (tab === 'valid') return validation.validRows;
    return [...validation.invalidRows, ...validation.validRows];
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Bulk CSV Import</h1>
        <p className="text-sm text-muted-foreground">
          Dry-run validation first, then commit only the valid rows atomically.
        </p>
      </div>

      <Card className="border-border bg-card text-card-foreground">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-card-foreground">1 · Upload CSV</CardTitle>
          <CardDescription className="text-muted-foreground">Max 10 MB / 10,000 rows.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Input type="file" accept=".csv,text/csv" onChange={(event) => void handleFile(event)} className="w-full sm:w-80" />
          <Button variant="outline" onClick={() => downloadText(TEMPLATE_CSV, 'stockpilot-catalog-template.csv')}>
            Download Strict CSV Template
          </Button>
          <Button variant="secondary" onClick={() => void validate(buildSampleCsv(), 'sample-mixed.csv')}>
            <Upload className="h-4 w-4" />
            Load Sample Mixed Hardware CSV
          </Button>
          {fileName ? (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {fileName} · {csvText.length} bytes
            </span>
          ) : null}
        </CardContent>
      </Card>

      {validating ? (
        <div className="space-y-2">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : null}

      {validation && !validating ? (
        <Card className="border-border bg-card text-card-foreground">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-card-foreground">2 · Validation preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertTitle>
                {validation.summary.totalRows} rows parsed: {validation.summary.validCount} valid •{' '}
                {validation.summary.invalidCount} invalid
              </AlertTitle>
              <AlertDescription>
                {validation.summary.duplicateSkusInFile > 0
                  ? `${validation.summary.duplicateSkusInFile} duplicate SKUs found inside the file. `
                  : ''}
                Invalid rows will be safely rejected; valid rows import in one idempotent batch.
              </AlertDescription>
            </Alert>

            {validation.headerErrors.length > 0 ? (
              <Alert variant="destructive">
                <AlertTitle>Header errors</AlertTitle>
                <AlertDescription>{validation.headerErrors.join(' ')}</AlertDescription>
              </Alert>
            ) : null}

            <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
              <TabsList>
                <TabsTrigger value="all">All Rows ({validation.summary.totalRows})</TabsTrigger>
                <TabsTrigger value="invalid">Invalid Only ({validation.summary.invalidCount})</TabsTrigger>
                <TabsTrigger value="valid">Valid Only ({validation.summary.validCount})</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="max-h-96 overflow-y-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Row</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">SKU</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Status</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Errors</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rowsToShow.map((row) => {
                    const invalid = 'errors' in row;
                    const sku = invalid ? (row.rawRow.sku ?? '') : row.sku;
                    return (
                      <TableRow
                        key={`${invalid ? 'i' : 'v'}-${row.rowNumber}`}
                        className={invalid ? 'bg-destructive/10 text-destructive' : 'h-9'}
                      >
                        <TableCell className="font-mono text-xs tabular-nums">{row.rowNumber}</TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">{sku}</TableCell>
                        <TableCell>
                          <Badge variant={invalid ? 'destructive' : 'secondary'}>{invalid ? 'INVALID' : 'VALID'}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {invalid
                            ? row.errors.map((error) => `${error.column}: ${error.message}`).join(' • ')
                            : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" onClick={downloadRejected} disabled={validation.summary.invalidCount === 0}>
                Download Rejected Rows CSV ({validation.summary.invalidCount})
              </Button>
              <Button
                onClick={() => commitMutation.mutate(validation.validationToken)}
                disabled={validation.summary.validCount === 0 || commitMutation.isPending}
              >
                {commitMutation.isPending
                  ? 'Importing…'
                  : `Import ${validation.summary.validCount} Valid Rows & Safely Reject ${validation.summary.invalidCount} Invalid Rows`}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
