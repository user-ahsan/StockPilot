/** Purchase order validation schemas (Rules 052, 088, 126). */
import { z } from 'zod';
import { UUID_RE } from './product.schema';

const uuid = z.string().regex(UUID_RE, 'Must be a UUID');
const currency = z.enum(['USD', 'EUR', 'GBP', 'PKR']);

export const poLineInputSchema = z
  .object({
    productVariantId: uuid,
    orderedQty: z.number().int().positive(),
    unitCostCents: z.number().int().min(0),
  })
  .strict();

export const createPurchaseOrderSchema = z
  .object({
    supplierId: uuid,
    locationId: uuid,
    currency: currency.default('USD'),
    expectedDeliveryDate: z.string().optional(),
    taxCents: z.number().int().min(0).optional(),
    taxRateBps: z.number().int().min(0).max(10_000).optional(),
    shippingCents: z.number().int().min(0).default(0),
    notes: z.string().max(2000).optional(),
    items: z.array(poLineInputSchema).min(1),
  })
  .strict()
  .refine((value) => new Set(value.items.map((item) => item.productVariantId)).size === value.items.length, {
    message: 'DUPLICATE_VARIANT_IN_PO',
    path: ['items'],
  });

export const submitPurchaseOrderSchema = z
  .object({
    notes: z.string().max(2000).optional(),
  })
  .strict();

export const approvePurchaseOrderSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().max(2000).optional(),
  })
  .strict()
  .refine((value) => value.decision !== 'REJECT' || (value.reason ?? '').trim().length >= 10, {
    message: 'REJECTION_REASON_REQUIRED',
    path: ['reason'],
  });

export const receivePurchaseOrderSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            productVariantId: uuid,
            receiveQty: z.number().int().min(0),
            notes: z.string().max(500).optional(),
          })
          .strict(),
      )
      .min(1),
    receiptNotes: z.string().max(2000).optional(),
  })
  .strict()
  .refine((value) => value.items.some((item) => item.receiveQty > 0), {
    message: 'NO_RECEIPT_QUANTITY',
    path: ['items'],
  })
  .refine((value) => new Set(value.items.map((item) => item.productVariantId)).size === value.items.length, {
    message: 'DUPLICATE_VARIANT_IN_RECEIPT',
    path: ['items'],
  });

export const poListQuerySchema = z.object({
  status: z.string().optional(),
  supplierId: z.string().regex(UUID_RE).optional(),
  locationId: z.string().regex(UUID_RE).optional(),
  search: z.string().trim().min(1).optional(),
});

export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type SubmitPurchaseOrderInput = z.infer<typeof submitPurchaseOrderSchema>;
export type ApprovePurchaseOrderInput = z.infer<typeof approvePurchaseOrderSchema>;
export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>;
