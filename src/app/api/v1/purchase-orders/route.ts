import { NextResponse, type NextRequest } from 'next/server';
import { createPurchaseOrderSchema, poListQuerySchema } from '@/lib/validators/purchase-order.schema';
import { jsonError, withAuth } from '@/server/middleware/with-auth';
import { withIdempotency } from '@/server/middleware/with-idempotency';
import { withRbac } from '@/server/middleware/with-rbac';
import {
  withCommerceStore,
  type CommerceStore,
  type PoStatus,
} from '@/server/services/inventory-ledger.service';
import { PurchaseOrderService, toPoError, type PoActor } from '@/server/services/purchase-order.service';

function runWithStore<T>(fn: (store: CommerceStore) => Promise<T>): Promise<T> {
  return withCommerceStore(fn);
}

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const parsed = poListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return jsonError(400, 'VALIDATION_ERROR', 'Invalid purchase order query.', ctx.correlationId, parsed.error.issues);
  }
  const status = parsed.data.status
    ? (parsed.data.status.split(',').filter(Boolean) as PoStatus[])
    : undefined;

  try {
    const rows = await runWithStore((store) =>
      PurchaseOrderService.listPurchaseOrders(store, ctx.organizationId, {
        status,
        supplierId: parsed.data.supplierId,
        locationId: parsed.data.locationId,
        search: parsed.data.search,
      }),
    );
    return NextResponse.json({ data: rows, meta: { correlationId: ctx.correlationId } });
  } catch (error) {
    const mapped = toPoError(error);
    if (mapped) return jsonError(mapped.status, mapped.code, mapped.message, ctx.correlationId, mapped.details);
    throw error;
  }
});

export const POST = withRbac(
  ['OWNER', 'MANAGER', 'PROCUREMENT_OFFICER'],
  withIdempotency(async (req: NextRequest, ctx) => {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonError(400, 'INVALID_JSON', 'Request body must be valid JSON.', ctx.correlationId);
    }
    const parsed = createPurchaseOrderSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, 'VALIDATION_ERROR', 'Invalid purchase order payload.', ctx.correlationId, parsed.error.issues);
    }

    const actor: PoActor = {
      memberId: ctx.memberId,
      role: ctx.role,
      correlationId: ctx.correlationId,
      ipAddress: req.headers.get('x-forwarded-for'),
      userAgent: req.headers.get('user-agent'),
    };

    try {
      const po = await runWithStore((store) =>
        PurchaseOrderService.createDraftPo(store, ctx.organizationId, actor, {
          supplierId: parsed.data.supplierId,
          locationId: parsed.data.locationId,
          currency: parsed.data.currency,
          expectedDeliveryDate: parsed.data.expectedDeliveryDate,
          taxCents: parsed.data.taxCents,
          taxRateBps: parsed.data.taxRateBps,
          shippingCents: parsed.data.shippingCents,
          notes: parsed.data.notes,
          items: parsed.data.items,
        }),
      );
      return NextResponse.json({ data: po, meta: { correlationId: ctx.correlationId } }, { status: 201 });
    } catch (error) {
      const mapped = toPoError(error);
      if (mapped) return jsonError(mapped.status, mapped.code, mapped.message, ctx.correlationId, mapped.details);
      throw error;
    }
  }),
);
