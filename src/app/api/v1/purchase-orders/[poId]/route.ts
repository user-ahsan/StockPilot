import { NextResponse, type NextRequest } from 'next/server';
import { UUID_RE } from '@/lib/validators/product.schema';
import { jsonError, withAuth } from '@/server/middleware/with-auth';
import { withCommerceStore } from '@/server/services/inventory-ledger.service';
import { PurchaseOrderService, toPoError } from '@/server/services/purchase-order.service';

export function poIdFrom(req: NextRequest): string | null {
  const segments = req.nextUrl.pathname.split('/').filter(Boolean);
  const index = segments.indexOf('purchase-orders');
  const candidate = index >= 0 ? segments[index + 1] : undefined;
  return candidate && UUID_RE.test(candidate) ? candidate : null;
}

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const poId = poIdFrom(req);
  if (!poId) return jsonError(400, 'INVALID_PO_ID', 'A valid poId is required.', ctx.correlationId);

  try {
    const detail = await withCommerceStore((store) =>
      PurchaseOrderService.getPurchaseOrderDetail(store, ctx.organizationId, poId),
    );
    return NextResponse.json({
      data: detail,
      meta: { correlationId: ctx.correlationId, viewerRole: ctx.role },
    });
  } catch (error) {
    const mapped = toPoError(error);
    if (mapped) return jsonError(mapped.status, mapped.code, mapped.message, ctx.correlationId, mapped.details);
    throw error;
  }
});
