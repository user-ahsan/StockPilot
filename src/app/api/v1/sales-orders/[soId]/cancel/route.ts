import { NextResponse, type NextRequest } from 'next/server';
import { cancelSalesOrderSchema } from '@/lib/validators/sales-order.schema';
import { UUID_RE } from '@/lib/validators/product.schema';
import { jsonError } from '@/server/middleware/with-auth';
import { withIdempotency } from '@/server/middleware/with-idempotency';
import { withRbac } from '@/server/middleware/with-rbac';
import { withCommerceStore } from '@/server/services/inventory-ledger.service';
import { SalesOrderService, toSoError, type SoActor } from '@/server/services/sales-order.service';

function soIdFrom(req: NextRequest): string | null {
  const segments = req.nextUrl.pathname.split('/').filter(Boolean);
  const index = segments.indexOf('sales-orders');
  const candidate = index >= 0 ? segments[index + 1] : undefined;
  return candidate && UUID_RE.test(candidate) ? candidate : null;
}

export const POST = withRbac(
  ['OWNER', 'MANAGER', 'SALES_ASSOCIATE'],
  withIdempotency(async (req: NextRequest, ctx) => {
    const soId = soIdFrom(req);
    if (!soId) return jsonError(400, 'INVALID_SO_ID', 'A valid soId is required.', ctx.correlationId);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonError(400, 'INVALID_JSON', 'Request body must be valid JSON.', ctx.correlationId);
    }
    const parsed = cancelSalesOrderSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, 'VALIDATION_ERROR', 'Invalid cancellation payload.', ctx.correlationId, parsed.error.issues);
    }

    const actor: SoActor = {
      memberId: ctx.memberId,
      role: ctx.role,
      correlationId: ctx.correlationId,
      ipAddress: req.headers.get('x-forwarded-for'),
      userAgent: req.headers.get('user-agent'),
    };

    try {
      const so = await withCommerceStore((store) =>
        SalesOrderService.cancelSalesOrder(store, ctx.organizationId, soId, actor, parsed.data.cancellationReason),
      );
      return NextResponse.json({ data: so, meta: { correlationId: ctx.correlationId } });
    } catch (error) {
      const mapped = toSoError(error);
      if (mapped) return jsonError(mapped.status, mapped.code, mapped.message, ctx.correlationId, mapped.details);
      throw error;
    }
  }),
);
