/**
 * CSV import/export schema helpers (Rules 113–120).
 * Client-safe: no `server-only`, relative imports only (test-friendly).
 */
import { z } from 'zod';
import { CURRENCY_REGEX, PRODUCT_SKU_REGEX } from './product.schema';

export const CSV_REQUIRED_HEADERS = [
  'sku',
  'name',
  'brand',
  'category',
  'supplier_code',
  'unit_cost',
  'selling_price',
  'currency',
  'reorder_point',
  'reorder_qty',
  'barcode_upc',
] as const;

export const CSV_MAX_BYTES = 10 * 1024 * 1024;
export const CSV_MAX_ROWS = 10_000;

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'] as const;

/** Rule 114 — true when a cell would be interpreted as a formula by Excel/Sheets. */
export function hasFormulaInjection(value: string): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix) || trimmed.startsWith(prefix));
}

/** Rule 119 — neutralise formula cells and RFC-4180 quote where needed. */
export function escapeCsvCellForExport(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const body = hasFormulaInjection(text) ? `'${text}` : text;
  const needsQuoting = /[",\n\r]/.test(body);
  return needsQuoting ? `"${body.replace(/"/g, '""')}"` : body;
}

/** Parsed + normalised catalog row (money already in integer cents). */
export interface ValidatedCsvCatalogRow {
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

export interface CsvRowError {
  column: string;
  code: string;
  message: string;
}

export interface InvalidCsvCatalogRow {
  rowNumber: number;
  rawRow: Record<string, string>;
  errors: CsvRowError[];
}

export interface CsvValidationSummary {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateSkusInFile: number;
}

export interface CsvValidationResult {
  validRows: ValidatedCsvCatalogRow[];
  invalidRows: InvalidCsvCatalogRow[];
  summary: CsvValidationSummary;
  headerErrors: string[];
  validationToken: string;
}

/** Happy-path shape for a raw parsed row (costs are still decimal strings). */
export const csvRawRowSchema = z.object({
  sku: z.string(),
  name: z.string(),
  brand: z.string(),
  category: z.string(),
  supplier_code: z.string(),
  unit_cost: z.string(),
  selling_price: z.string(),
  currency: z.string().regex(CURRENCY_REGEX),
  reorder_point: z.string(),
  reorder_qty: z.string(),
  barcode_upc: z.string().optional(),
});

export const TEXT_COLUMNS = ['sku', 'name', 'brand', 'category', 'supplier_code', 'barcode_upc'] as const;

export { PRODUCT_SKU_REGEX };
