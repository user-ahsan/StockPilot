/** Sales order validation schemas (Rules 088, 110, 112, 129). */
import { z } from 'zod';
import { UUID_RE } from './product.schema';

const uuid = z.string().regex(UUID_RE, 'Must be a UUID');
const currency = z.enum(['USD', 'EUR', 'GBP', 'PKR']);

/**
 * NOTE: line items deliberately carry NO unit price — the server always reads
 * the authoritative `selling_price_cents` from the catalog (Rule 112).
 */
export const soLineInputSchema = z
  .object({
    productVariantId: uuid,
    quantity: z.number().int().positive(),
  })
  .strict();

export const createSalesOrderSchema = z
  .object({
    locationId: uuid,
    customerName: z.string().min(2).max(160),
    customerEmail: z.string().email().optional(),
    currency: currency.default('USD'),
    taxRateBps: z.number().int().min(0).max(10_000).default(0),
    discountCents: z.number().int().min(0).default(0),
    confirmImmediately: z.boolean().default(true),
    notes: z.string().max(2000).optional(),
    items: z.array(soLineInputSchema).min(1),
  })
  .strict()
  .refine((value) => new Set(value.items.map((item) => item.productVariantId)).size === value.items.length, {
    message: 'DUPLICATE_VARIANT_IN_SO',
    path: ['items'],
  });

export const fulfillSalesOrderSchema = z
  .object({
    fulfillmentNotes: z.string().max(2000).optional(),
  })
  .strict();

export const cancelSalesOrderSchema = z
  .object({
    cancellationReason: z.string().trim().min(10).max(2000),
  })
  .strict();

export const soListQuerySchema = z.object({
  soId: z.string().regex(UUID_RE).optional(),
  status: z.string().optional(),
  locationId: z.string().regex(UUID_RE).optional(),
  search: z.string().trim().min(1).optional(),
});

export type CreateSalesOrderInput = z.infer<typeof createSalesOrderSchema>;
export type FulfillSalesOrderInput = z.infer<typeof fulfillSalesOrderSchema>;
export type CancelSalesOrderInput = z.infer<typeof cancelSalesOrderSchema>;
