import { NextResponse, type NextRequest } from 'next/server';
import { reviewStockAdjustmentSchema } from '@/lib/validators/adjustment.schema';
import { UUID_RE } from '@/lib/validators/product.schema';
import { jsonError } from '@/server/middleware/with-auth';
import { withIdempotency } from '@/server/middleware/with-idempotency';
import { withRbac } from '@/server/middleware/with-rbac';
import { withCommerceStore } from '@/server/services/inventory-ledger.service';
import { AdjustmentService, toAdjustmentError, type AdjustmentActor } from '@/server/services/adjustment.service';

function adjIdFrom(req: NextRequest): string | null {
  const segments = req.nextUrl.pathname.split('/').filter(Boolean);
  const index = segments.indexOf('stock-adjustments');
  const candidate = index >= 0 ? segments[index + 1] : undefined;
  return candidate && UUID_RE.test(candidate) ? candidate : null;
}

export const POST = withRbac(
  ['OWNER', 'MANAGER'],
  withIdempotency(async (req: NextRequest, ctx) => {
    const adjId = adjIdFrom(req);
    if (!adjId) return jsonError(400, 'INVALID_ADJUSTMENT_ID', 'A valid adjustment id is required.', ctx.correlationId);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonError(400, 'INVALID_JSON', 'Request body must be valid JSON.', ctx.correlationId);
    }
    const parsed = reviewStockAdjustmentSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, 'VALIDATION_ERROR', 'Invalid review payload.', ctx.correlationId, parsed.error.issues);
    }

    const actor: AdjustmentActor = {
      memberId: ctx.memberId,
      role: ctx.role,
      correlationId: ctx.correlationId,
      ipAddress: req.headers.get('x-forwarded-for'),
      userAgent: req.headers.get('user-agent'),
    };

    try {
      const record = await withCommerceStore((store) =>
        AdjustmentService.reviewSuspiciousAdjustment(store, ctx.organizationId, adjId, actor, parsed.data),
      );
      return NextResponse.json({ data: record, meta: { correlationId: ctx.correlationId } });
    } catch (error) {
      const mapped = toAdjustmentError(error);
      if (mapped) return jsonError(mapped.status, mapped.code, mapped.message, ctx.correlationId, mapped.details);
      throw error;
    }
  }),
);
