/** Stock adjustment validation schemas (Rules 131–132). */
import { z } from 'zod';
import { UUID_RE } from './product.schema';

const uuid = z.string().regex(UUID_RE, 'Must be a UUID');

export const ADJUSTMENT_REASON_CODES = [
  'DAMAGED_IN_TRANSIT',
  'WAREHOUSE_BREAKAGE',
  'THEFT_SHRINKAGE',
  'CYCLE_COUNT_SURPLUS',
  'CYCLE_COUNT_DEFICIT',
  'WARRANTY_RETURN',
  'EXPIRED_OBSOLETE',
] as const;

export const createStockAdjustmentSchema = z
  .object({
    locationId: uuid,
    productVariantId: uuid,
    quantityDelta: z.number().int(),
    reasonCode: z.enum(ADJUSTMENT_REASON_CODES),
    reasonNotes: z.string().trim().min(15, 'reasonNotes must be at least 15 characters').max(1000),
  })
  .strict()
  .refine((value) => value.quantityDelta !== 0, {
    message: 'QUANTITY_DELTA_ZERO',
    path: ['quantityDelta'],
  });

export const reviewStockAdjustmentSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    reviewNotes: z.string().trim().min(10).max(1000),
  })
  .strict();

export const adjustmentListQuerySchema = z.object({
  locationId: z.string().regex(UUID_RE).optional(),
  onlySuspicious: z.string().optional(),
  status: z.string().optional(),
  reasonCode: z.string().optional(),
});

export type CreateStockAdjustmentInput = z.infer<typeof createStockAdjustmentSchema>;
export type ReviewStockAdjustmentInput = z.infer<typeof reviewStockAdjustmentSchema>;
