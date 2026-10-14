import 'server-only';

/**
 * Bulk CSV catalog import engine (Rules 113–120, Doc 3 §3.5).
 *
 * `validateCsv` is side-effect free; `commitValidRows` writes inside a single
 * transaction (or a supplied adapter, so tests can run without PostgreSQL).
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import Papa from 'papaparse';
import { decimalStringToCents, MoneyPrecisionError } from '../../lib/money';
import {
  CSV_MAX_BYTES,
  CSV_MAX_ROWS,
  CSV_REQUIRED_HEADERS,
  CSV_REQUIRED_HEADERS as REQUIRED_HEADERS,
  hasFormulaInjection,
  TEXT_COLUMNS,
  type CsvRowError,
  type CsvValidationResult,
  type InvalidCsvCatalogRow,
  type ValidatedCsvCatalogRow,
} from '../../lib/validators/csv.schema';
import { PRODUCT_SKU_REGEX, SUPPORTED_CURRENCIES } from '../../lib/validators/product.schema';
import { db } from '../db';
import { inventoryBalances, locations, productVariants, products, suppliers } from '../db/schema';
import type { MemberRole } from '../middleware/with-auth';
import { AuditService } from './audit.service';

export class CsvImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'CsvImportError';
  }
}

export interface CsvCommitActor {
  memberId: string;
  role: MemberRole;
  correlationId: string;
}

export interface CsvCommitResult {
  importedValidCount: number;
  rejectedInvalidCount: number;
  skippedExistingCount: number;
  totalUploaded: number;
}

export interface CsvCommitAdapter {
  commit(
    organizationId: string,
    actor: CsvCommitActor,
    rows: ValidatedCsvCatalogRow[],
    meta: { rejectedInvalidCount: number; totalUploaded: number },
  ): Promise<CsvCommitResult>;
}

/** Deterministic commit target for unit tests (idempotent by SKU). */
export class InMemoryCsvCommitAdapter implements CsvCommitAdapter {
  readonly committedSkus = new Set<string>();

  async commit(
    _organizationId: string,
    _actor: CsvCommitActor,
    rows: ValidatedCsvCatalogRow[],
    meta: { rejectedInvalidCount: number; totalUploaded: number },
  ): Promise<CsvCommitResult> {
    let imported = 0;
    let skipped = 0;
    for (const row of rows) {
      if (this.committedSkus.has(row.sku)) {
        skipped += 1;
      } else {
        this.committedSkus.add(row.sku);
        imported += 1;
      }
    }
    return {
      importedValidCount: imported,
      rejectedInvalidCount: meta.rejectedInvalidCount,
      skippedExistingCount: skipped,
      totalUploaded: meta.totalUploaded,
    };
  }
}

function parseMoneyColumn(value: string, column: string): { cents: number } | { error: CsvRowError } {
  const raw = (value ?? '').trim();
  if (raw === '') {
    return { error: { column, code: 'REQUIRED', message: `${column} is required.` } };
  }
  try {
    const cents = decimalStringToCents(raw);
    if (cents < 0) {
      return { error: { column, code: 'NEGATIVE_AMOUNT', message: `${column} must be a non-negative amount.` } };
    }
    return { cents };
  } catch (error) {
    const reason = error instanceof MoneyPrecisionError ? error.message : `${column} must be a decimal amount.`;
    return { error: { column, code: 'INVALID_AMOUNT', message: reason } };
  }
}

function parseIntegerColumn(value: string, column: string, positive: boolean): { value: number } | { error: CsvRowError } {
  const raw = (value ?? '').trim();
  if (raw === '') return { error: { column, code: 'REQUIRED', message: `${column} is required.` } };
  if (!/^-?\d+$/.test(raw)) {
    return { error: { column, code: 'INVALID_INTEGER', message: `${column} must be an integer.` } };
  }
  const parsed = Number(raw);
  if (positive ? parsed <= 0 : parsed < 0) {
    return {
      error: {
        column,
        code: positive ? 'MUST_BE_POSITIVE' : 'NEGATIVE_VALUE',
        message: positive ? `${column} must be greater than 0.` : `${column} must be >= 0.`,
      },
    };
  }
  return { value: parsed };
}

function validateRow(
  rawRow: Record<string, string>,
  rowNumber: number,
  knownSupplierCodes: ReadonlySet<string>,
  seenSkus: Map<string, number>,
): { valid: ValidatedCsvCatalogRow } | { invalid: InvalidCsvCatalogRow } {
  const errors: CsvRowError[] = [];
  const get = (column: string): string => (rawRow[column] ?? '').toString();

  // Formula injection across every text column (Rule 114).
  for (const column of TEXT_COLUMNS) {
    const cell = get(column);
    if (cell && hasFormulaInjection(cell)) {
      errors.push({
        column,
        code: 'FORMULA_INJECTION_BLOCKED',
        message: `${column} starts with a formula control character and was blocked.`,
      });
    }
  }

  const sku = get('sku').trim();
  if (!PRODUCT_SKU_REGEX.test(sku)) {
    errors.push({ column: 'sku', code: 'MALFORMED_SKU', message: 'SKU must match ^[A-Z0-9-_]{3,64}$.' });
  } else {
    const firstRow = seenSkus.get(sku);
    if (firstRow !== undefined) {
      errors.push({
        column: 'sku',
        code: 'DUPLICATE_SKU_IN_CSV',
        message: `Duplicate SKU "${sku}" already appeared on row ${firstRow}.`,
      });
    } else {
      seenSkus.set(sku, rowNumber);
    }
  }

  for (const column of ['name', 'brand', 'category'] as const) {
    if (get(column).trim() === '') {
      errors.push({ column, code: 'REQUIRED', message: `${column} is required.` });
    }
  }

  const supplierCode = get('supplier_code').trim();
  if (supplierCode === '') {
    errors.push({ column: 'supplier_code', code: 'REQUIRED', message: 'supplier_code is required.' });
  } else if (!knownSupplierCodes.has(supplierCode)) {
    errors.push({
      column: 'supplier_code',
      code: 'UNKNOWN_SUPPLIER',
      message: `Unknown supplier_code "${supplierCode}".`,
    });
  }

  const currency = get('currency').trim().toUpperCase();
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
    errors.push({
      column: 'currency',
      code: 'INVALID_CURRENCY',
      message: `currency must be one of ${SUPPORTED_CURRENCIES.join(', ')}.`,
    });
  }

  const unitCost = parseMoneyColumn(get('unit_cost'), 'unit_cost');
  if ('error' in unitCost) errors.push(unitCost.error);
  const sellingPrice = parseMoneyColumn(get('selling_price'), 'selling_price');
  if ('error' in sellingPrice) errors.push(sellingPrice.error);
  const reorderPoint = parseIntegerColumn(get('reorder_point'), 'reorder_point', false);
  if ('error' in reorderPoint) errors.push(reorderPoint.error);
  const reorderQty = parseIntegerColumn(get('reorder_qty'), 'reorder_qty', true);
  if ('error' in reorderQty) errors.push(reorderQty.error);

  if (errors.length > 0) {
    return { invalid: { rowNumber, rawRow, errors } };
  }

  return {
    valid: {
      rowNumber,
      sku,
      name: get('name').trim(),
      brand: get('brand').trim(),
      category: get('category').trim(),
      supplierCode,
      unitCostCents: (unitCost as { cents: number }).cents,
      sellingPriceCents: (sellingPrice as { cents: number }).cents,
      currency,
      reorderPoint: (reorderPoint as { value: number }).value,
      reorderQty: (reorderQty as { value: number }).value,
      barcodeUpc: get('barcode_upc').trim() || null,
    },
  };
}

export interface ValidateCsvInput {
  csvText: string;
  knownSupplierCodes?: ReadonlySet<string>;
}

export function validateCsv(input: ValidateCsvInput): CsvValidationResult {
  const bytes = Buffer.byteLength(input.csvText, 'utf8');
  if (bytes > CSV_MAX_BYTES) {
    throw new CsvImportError('PAYLOAD_TOO_LARGE', 'CSV exceeds the 10 MB limit.', 413);
  }

  const parsed = Papa.parse<Record<string, string>>(input.csvText, {
    header: true,
    skipEmptyLines: 'greedy',
  });
  const rows = parsed.data.filter((row) => Object.values(row).some((value) => (value ?? '').toString().trim() !== ''));

  if (rows.length > CSV_MAX_ROWS) {
    throw new CsvImportError('ROW_LIMIT_EXCEEDED', `CSV exceeds the ${CSV_MAX_ROWS} row limit.`, 413);
  }

  const fields = (parsed.meta.fields ?? []) as string[];
  const headerErrors = CSV_REQUIRED_HEADERS.filter((header) => !fields.includes(header)).map(
    (header) => `Missing required column "${header}".`,
  );

  const knownSupplierCodes = input.knownSupplierCodes ?? new Set<string>();
  const validRows: ValidatedCsvCatalogRow[] = [];
  const invalidRows: InvalidCsvCatalogRow[] = [];
  const seenSkus = new Map<string, number>();
  let duplicateSkusInFile = 0;

  if (headerErrors.length === 0) {
    rows.forEach((rawRow, index) => {
      const outcome = validateRow(rawRow, index + 2, knownSupplierCodes, seenSkus); // +2: 1 header + 1-based
      if ('valid' in outcome) {
        validRows.push(outcome.valid);
      } else {
        if (outcome.invalid.errors.some((error) => error.code === 'DUPLICATE_SKU_IN_CSV')) duplicateSkusInFile += 1;
        invalidRows.push(outcome.invalid);
      }
    });
  }

  const summary = {
    totalRows: rows.length,
    validCount: validRows.length,
    invalidCount: invalidRows.length,
    duplicateSkusInFile,
  };

  const validationToken = createHash('sha256')
    .update(`${input.csvText}|${summary.totalRows}|${summary.validCount}|${summary.invalidCount}`)
    .digest('hex');

  return { validRows, invalidRows, summary, headerErrors, validationToken };
}

async function commitWithPostgres(
  organizationId: string,
  actor: CsvCommitActor,
  rows: ValidatedCsvCatalogRow[],
  meta: { rejectedInvalidCount: number; totalUploaded: number },
): Promise<CsvCommitResult> {
  const supplierRows = await db
    .select({ id: suppliers.id, code: suppliers.code })
    .from(suppliers)
    .where(eq(suppliers.organizationId, organizationId));
  const supplierByCode = new Map(supplierRows.map((row) => [row.code, row.id]));

  const locationRows = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.organizationId, organizationId));

  return db.transaction(async (tx) => {
    let imported = 0;
    let skipped = 0;

    for (const row of rows) {
      const supplierId = supplierByCode.get(row.supplierCode);
      if (!supplierId) {
        skipped += 1;
        continue;
      }

      const [existingVariant] = await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(and(eq(productVariants.organizationId, organizationId), eq(productVariants.sku, row.sku)))
        .limit(1);
      if (existingVariant) {
        skipped += 1;
        continue;
      }

      const [product] = await tx
        .insert(products)
        .values({ organizationId, name: row.name, brand: row.brand, category: row.category })
        .returning({ id: products.id });

      const [variant] = await tx
        .insert(productVariants)
        .values({
          organizationId,
          productId: product.id,
          primarySupplierId: supplierId,
          sku: row.sku,
          barcodeUpc: row.barcodeUpc,
          variantName: row.name,
          currency: row.currency,
          unitCostCents: row.unitCostCents,
          sellingPriceCents: row.sellingPriceCents,
          reorderPoint: row.reorderPoint,
          reorderQty: row.reorderQty,
        })
        .returning({ id: productVariants.id });

      if (locationRows.length > 0) {
        await tx
          .insert(inventoryBalances)
          .values(locationRows.map((location) => ({ organizationId, locationId: location.id, productVariantId: variant.id, onHandQty: 0, reservedQty: 0 })))
          .onConflictDoNothing();
      }

      imported += 1;
    }

    await AuditService.record(tx, {
      organizationId,
      actorMemberId: actor.memberId,
      actorRole: actor.role,
      action: 'AUDIT_BULK_CATALOG_IMPORT',
      entityType: 'product_variants',
      entityId: actor.correlationId,
      afterState: {
        totalUploaded: meta.totalUploaded,
        importedValidCount: imported,
        rejectedInvalidCount: meta.rejectedInvalidCount,
      },
      correlationId: actor.correlationId,
    });

    return {
      importedValidCount: imported,
      rejectedInvalidCount: meta.rejectedInvalidCount,
      skippedExistingCount: skipped,
      totalUploaded: meta.totalUploaded,
    };
  });
}

export async function commitValidRows(
  organizationId: string,
  actor: CsvCommitActor,
  rows: ValidatedCsvCatalogRow[],
  options: { adapter?: CsvCommitAdapter; rejectedInvalidCount?: number; totalUploaded?: number } = {},
): Promise<CsvCommitResult> {
  const meta = {
    rejectedInvalidCount: options.rejectedInvalidCount ?? 0,
    totalUploaded: options.totalUploaded ?? rows.length,
  };
  if (options.adapter) {
    return options.adapter.commit(organizationId, actor, rows, meta);
  }
  return commitWithPostgres(organizationId, actor, rows, meta);
}

export async function resolveKnownSupplierCodes(organizationId: string): Promise<Set<string>> {
  const rows = await db
    .select({ code: suppliers.code })
    .from(suppliers)
    .where(eq(suppliers.organizationId, organizationId));
  return new Set(rows.map((row) => row.code));
}

export async function listSupplierCodesIn(organizationId: string, codes: string[]): Promise<string[]> {
  if (codes.length === 0) return [];
  const rows = await db
    .select({ code: suppliers.code })
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, organizationId), inArray(suppliers.code, codes)));
  return rows.map((row) => row.code);
}

export { REQUIRED_HEADERS };
