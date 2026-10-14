import { NextResponse, type NextRequest } from 'next/server';
import { receivePurchaseOrderSchema } from '@/lib/validators/purchase-order.schema';
import { UUID_RE } from '@/lib/validators/product.schema';
import { jsonError } from '@/server/middleware/with-auth';
import { withIdempotency } from '@/server/middleware/with-idempotency';
import { LocationAccessError, withRbac } from '@/server/middleware/with-rbac';
import { withCommerceStore } from '@/server/services/inventory-ledger.service';
import { PoNotFoundError, PurchaseOrderService, toPoError, type PoActor } from '@/server/services/purchase-order.service';

function poIdFrom(req: NextRequest): string | null {
  const segments = req.nextUrl.pathname.split('/').filter(Boolean);
  const index = segments.indexOf('purchase-orders');
  const candidate = index >= 0 ? segments[index + 1] : undefined;
  return candidate && UUID_RE.test(candidate) ? candidate : null;
}

/** Rule 128 — WAREHOUSE_CLERK / MANAGER / OWNER, location-scoped, idempotent. */
export const POST = withRbac(
  ['OWNER', 'MANAGER', 'WAREHOUSE_CLERK'],
  withIdempotency(async (req: NextRequest, ctx) => {
    const poId = poIdFrom(req);
    if (!poId) return jsonError(400, 'INVALID_PO_ID', 'A valid poId is required.', ctx.correlationId);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonError(400, 'INVALID_JSON', 'Request body must be valid JSON.', ctx.correlationId);
    }
    const parsed = receivePurchaseOrderSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, 'VALIDATION_ERROR', 'Invalid receipt payload.', ctx.correlationId, parsed.error.issues);
    }

    const actor: PoActor = {
      memberId: ctx.memberId,
      role: ctx.role,
      correlationId: ctx.correlationId,
      ipAddress: req.headers.get('x-forwarded-for'),
      userAgent: req.headers.get('user-agent'),
    };

    try {
      const result = await withCommerceStore(async (store) => {
        const po = await store.getPo(ctx.organizationId, poId);
        if (!po) throw new PoNotFoundError(poId);
        if (ctx.assignedLocationId !== null && ctx.assignedLocationId !== po.locationId && ctx.role !== 'OWNER' && ctx.role !== 'MANAGER') {
          throw new LocationAccessError(po.locationId);
        }
        return PurchaseOrderService.receivePurchaseOrderStock(store, ctx.organizationId, poId, actor, parsed.data);
      });
      return NextResponse.json({ data: result, meta: { correlationId: ctx.correlationId } });
    } catch (error) {
      if (error instanceof LocationAccessError) {
        return jsonError(403, 'LOCATION_FORBIDDEN', error.message, ctx.correlationId, { requiredLocationId: error.targetLocationId });
      }
      const mapped = toPoError(error);
      if (mapped) return jsonError(mapped.status, mapped.code, mapped.message, ctx.correlationId, mapped.details);
      throw error;
    }
  }),
);
