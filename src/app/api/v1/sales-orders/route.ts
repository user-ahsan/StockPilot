import { NextResponse, type NextRequest } from 'next/server';
import { createSalesOrderSchema, soListQuerySchema } from '@/lib/validators/sales-order.schema';
import { jsonError, withAuth } from '@/server/middleware/with-auth';
import { withIdempotency } from '@/server/middleware/with-idempotency';
import { withRbac } from '@/server/middleware/with-rbac';
import {
  withCommerceStore,
  type CommerceStore,
  type SoStatus,
} from '@/server/services/inventory-ledger.service';
import { SalesOrderService, toSoError, type SoActor } from '@/server/services/sales-order.service';

function runWithStore<T>(fn: (store: CommerceStore) => Promise<T>): Promise<T> {
  return withCommerceStore(fn);
}

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const parsed = soListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return jsonError(400, 'VALIDATION_ERROR', 'Invalid sales order query.', ctx.correlationId, parsed.error.issues);
  }
  const status = parsed.data.status ? (parsed.data.status.split(',').filter(Boolean) as SoStatus[]) : undefined;

  const soId = parsed.data.soId;
  try {
    const data = soId
      ? await runWithStore((store) => SalesOrderService.getSalesOrderDetail(store, ctx.organizationId, soId))
      : await runWithStore((store) =>
          SalesOrderService.listSalesOrders(store, ctx.organizationId, {
            status,
            locationId: parsed.data.locationId,
            search: parsed.data.search,
          }),
        );
    return NextResponse.json({ data, meta: { correlationId: ctx.correlationId, viewerRole: ctx.role } });
  } catch (error) {
    const mapped = toSoError(error);
    if (mapped) return jsonError(mapped.status, mapped.code, mapped.message, ctx.correlationId, mapped.details);
    throw error;
  }
});

export const POST = withRbac(
  ['OWNER', 'MANAGER', 'SALES_ASSOCIATE'],
  withIdempotency(async (req: NextRequest, ctx) => {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonError(400, 'INVALID_JSON', 'Request body must be valid JSON.', ctx.correlationId);
    }
    const parsed = createSalesOrderSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, 'VALIDATION_ERROR', 'Invalid sales order payload.', ctx.correlationId, parsed.error.issues);
    }

    const actor: SoActor = {
      memberId: ctx.memberId,
      role: ctx.role,
      correlationId: ctx.correlationId,
      ipAddress: req.headers.get('x-forwarded-for'),
      userAgent: req.headers.get('user-agent'),
    };

    try {
      const so = await runWithStore((store) =>
        SalesOrderService.createAndConfirmSalesOrder(store, ctx.organizationId, actor, parsed.data),
      );
      return NextResponse.json({ data: so, meta: { correlationId: ctx.correlationId } }, { status: 201 });
    } catch (error) {
      const mapped = toSoError(error);
      if (mapped) return jsonError(mapped.status, mapped.code, mapped.message, ctx.correlationId, mapped.details);
      throw error;
    }
  }),
);
