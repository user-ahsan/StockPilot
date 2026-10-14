import { NextResponse, type NextRequest } from 'next/server';
import { adjustmentListQuerySchema, createStockAdjustmentSchema } from '@/lib/validators/adjustment.schema';
import { jsonError, withAuth } from '@/server/middleware/with-auth';
import { withIdempotency } from '@/server/middleware/with-idempotency';
import { withRbac } from '@/server/middleware/with-rbac';
import { withCommerceStore, type AdjustmentStatusValue } from '@/server/services/inventory-ledger.service';
import { AdjustmentService, toAdjustmentError, type AdjustmentActor } from '@/server/services/adjustment.service';

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const parsed = adjustmentListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return jsonError(400, 'VALIDATION_ERROR', 'Invalid adjustment query.', ctx.correlationId, parsed.error.issues);
  }
  const status = parsed.data.status
    ? (parsed.data.status.split(',').filter(Boolean) as AdjustmentStatusValue[])
    : undefined;

  try {
    const rows = await withCommerceStore((store) =>
      AdjustmentService.listAdjustments(store, ctx.organizationId, {
        locationId: parsed.data.locationId,
        onlySuspicious: parsed.data.onlySuspicious === 'true',
        status,
        reasonCode: parsed.data.reasonCode,
      }),
    );
    return NextResponse.json({ data: rows, meta: { correlationId: ctx.correlationId, viewerRole: ctx.role } });
  } catch (error) {
    const mapped = toAdjustmentError(error);
    if (mapped) return jsonError(mapped.status, mapped.code, mapped.message, ctx.correlationId, mapped.details);
    throw error;
  }
});

export const POST = withRbac(
  ['OWNER', 'MANAGER', 'WAREHOUSE_CLERK'],
  withIdempotency(async (req: NextRequest, ctx) => {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonError(400, 'INVALID_JSON', 'Request body must be valid JSON.', ctx.correlationId);
    }
    const parsed = createStockAdjustmentSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, 'VALIDATION_ERROR', 'Invalid adjustment payload.', ctx.correlationId, parsed.error.issues);
    }

    const idempotencyKey = req.headers.get('idempotency-key') ?? ctx.correlationId;
    const actor: AdjustmentActor = {
      memberId: ctx.memberId,
      role: ctx.role,
      correlationId: ctx.correlationId,
      ipAddress: req.headers.get('x-forwarded-for'),
      userAgent: req.headers.get('user-agent'),
    };

    try {
      const record = await withCommerceStore((store) =>
        AdjustmentService.createStockAdjustment(store, ctx.organizationId, actor, idempotencyKey, parsed.data),
      );
      return NextResponse.json({ data: record, meta: { correlationId: ctx.correlationId } }, { status: 201 });
    } catch (error) {
      const mapped = toAdjustmentError(error);
      if (mapped) return jsonError(mapped.status, mapped.code, mapped.message, ctx.correlationId, mapped.details);
      throw error;
    }
  }),
);
