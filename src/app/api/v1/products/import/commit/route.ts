import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/server/middleware/with-auth';
import { withIdempotency } from '@/server/middleware/with-idempotency';
import { withRbac } from '@/server/middleware/with-rbac';
import { commitValidRows } from '@/server/services/csv-import.service';

const validatedRowSchema = z.object({
  rowNumber: z.number().int().min(1),
  sku: z.string().min(1),
  name: z.string().min(1),
  brand: z.string().min(1),
  category: z.string().min(1),
  supplierCode: z.string().min(1),
  unitCostCents: z.number().int().min(0),
  sellingPriceCents: z.number().int().min(0),
  currency: z.string().min(3).max(3),
  reorderPoint: z.number().int().min(0),
  reorderQty: z.number().int().positive(),
  barcodeUpc: z.string().nullable(),
});

const bodySchema = z
  .object({
    validRows: z.array(validatedRowSchema).max(10_000),
    validationToken: z.string().min(8),
    rejectedInvalidCount: z.number().int().min(0).default(0),
    totalUploaded: z.number().int().min(0).default(0),
  })
  .strict();

export const POST = withRbac(
  ['OWNER', 'MANAGER', 'PROCUREMENT_OFFICER'],
  withIdempotency(async (req: NextRequest, ctx) => {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonError(400, 'INVALID_JSON', 'Request body must be valid JSON.', ctx.correlationId);
    }

    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, 'VALIDATION_ERROR', 'Invalid CSV commit payload.', ctx.correlationId, parsed.error.issues);
    }

    const result = await commitValidRows(
      ctx.organizationId,
      { memberId: ctx.memberId, role: ctx.role, correlationId: ctx.correlationId },
      parsed.data.validRows,
      {
        rejectedInvalidCount: parsed.data.rejectedInvalidCount,
        totalUploaded: parsed.data.totalUploaded || parsed.data.validRows.length,
      },
    );

    return NextResponse.json({ data: result, meta: { correlationId: ctx.correlationId } }, { status: 201 });
  }),
);
