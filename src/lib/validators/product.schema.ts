/**
 * Product catalog & supplier validation schemas (Rules 036, 061–062, 106–112).
 *
 * The update schema is `.strict()` ON PURPOSE — a payload carrying a stock
 * quantity field is rejected with 400 (Rule 062) — balances only move through
 * the inventory ledger.
 */
import { z } from 'zod';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PRODUCT_SKU_REGEX = /^[A-Z0-9-_]{3,64}$/;
export const SUPPLIER_CODE_REGEX = /^[A-Z0-9-]{2,32}$/;
export const CURRENCY_REGEX = /^[A-Z]{3}$/;
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'PKR'] as const;

export const REORDER_STATUSES = ['ALL', 'IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'DISCONTINUED'] as const;
export type ReorderStatus = (typeof REORDER_STATUSES)[number];

export const SORT_FIELDS = [
  'sku',
  'variantName',
  'category',
  'unitCostCents',
  'sellingPriceCents',
  'availableQty',
  'updatedAt',
] as const;

const uuid = z.string().regex(UUID_RE, 'Must be a UUID');

export const productCatalogFilterSchema = z.object({
  search: z.string().trim().min(1).optional(),
  category: z.string().min(1).optional(),
  supplierId: uuid.optional(),
  reorderStatus: z.enum(REORDER_STATUSES).default('ALL'),
  locationId: z.string().refine((value) => value === 'ALL' || UUID_RE.test(value)).optional(),
  sortBy: z.enum(SORT_FIELDS).default('sku'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const createProductVariantSchema = z
  .object({
    sku: z.string().regex(PRODUCT_SKU_REGEX, 'SKU must match ^[A-Z0-9-_]{3,64}$'),
    barcodeUpc: z.string().min(1).max(64).optional(),
    productName: z.string().min(1).max(200),
    brand: z.string().min(1).max(100),
    category: z.string().min(1).max(100),
    variantName: z.string().min(1).max(200),
    attributes: z.record(z.string(), z.string()).optional(),
    primarySupplierId: uuid,
    currency: z.string().regex(CURRENCY_REGEX).default('USD'),
    unitCostCents: z.number().int().min(0),
    sellingPriceCents: z.number().int().min(0),
    reorderPoint: z.number().int().min(0).default(5),
    reorderQty: z.number().int().positive().default(10),
    imageUrl: z.string().url().optional(),
    // NOTE: onHandQty / reservedQty / availableQty are intentionally absent.
  })
  .strict();

export const updateProductVariantSchema = z
  .object({
    variantName: z.string().min(1).max(200).optional(),
    barcodeUpc: z.string().min(1).max(64).nullable().optional(),
    category: z.string().min(1).max(100).optional(),
    primarySupplierId: uuid.optional(),
    reorderPoint: z.number().int().min(0).optional(),
    reorderQty: z.number().int().positive().optional(),
    isActive: z.boolean().optional(),
    attributes: z.record(z.string(), z.string()).optional(),
    unitCostCents: z.number().int().min(0).optional(),
    sellingPriceCents: z.number().int().min(0).optional(),
    currency: z.string().regex(CURRENCY_REGEX).optional(),
  })
  .strict();

export const createSupplierSchema = z
  .object({
    code: z.string().regex(SUPPLIER_CODE_REGEX, 'Supplier code must match ^[A-Z0-9-]{2,32}$'),
    name: z.string().min(1).max(160),
    contactName: z.string().min(1).max(120),
    orderEmail: z.string().email(),
    phone: z.string().max(40).optional(),
    currency: z.string().regex(CURRENCY_REGEX).default('USD'),
    leadTimeDays: z.number().int().min(0).default(7),
  })
  .strict();

export type ProductCatalogFilter = z.infer<typeof productCatalogFilterSchema>;
export type CreateProductVariantInput = z.infer<typeof createProductVariantSchema>;
export type UpdateProductVariantInput = z.infer<typeof updateProductVariantSchema>;
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

/** Any key that would let a caller write stock balances directly (Rules 061–062). */
export const STOCK_QUANTITY_KEYS = [
  'on_hand_qty',
  'onHandQty',
  'reserved_qty',
  'reservedQty',
  'available_qty',
  'availableQty',
] as const;

export function findStockQuantityKey(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  for (const key of STOCK_QUANTITY_KEYS) {
    if (key in (body as Record<string, unknown>)) return key;
  }
  return null;
}
