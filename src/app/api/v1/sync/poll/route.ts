import { and, count, eq, isNull, lte, max } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getPublicEnv } from '@/lib/env';
import { db } from '@/server/db';
import {
  inventoryBalances,
  productVariants,
  purchaseOrders,
  stockAdjustments,
  stockMovements,
} from '@/server/db/schema';
import { jsonError, withAuth } from '@/server/middleware/with-auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pollQuerySchema = z
  .object({
    locationId: z
      .string()
      .refine((value) => value === 'ALL' || UUID_RE.test(value), 'locationId must be "ALL" or a UUID')
      .optional(),
    sinceLedgerId: z.coerce.number().int().min(0).optional(),
  })
  .strict();

interface PollData {
  latestLedgerId: number;
  latestPoUpdatedAt: string | null;
  pendingPoApprovalCount: number;
  lowStockCount: number;
  flaggedAdjustmentCount: number;
  hasChanges: boolean;
  serverTime: string;
}

async function loadPollData(
  organizationId: string,
  locationId: string | null,
  sinceLedgerId: number | undefined,
): Promise<PollData> {
  const movementScope = locationId
    ? and(eq(stockMovements.organizationId, organizationId), eq(stockMovements.locationId, locationId))
    : eq(stockMovements.organizationId, organizationId);
  const balanceScope = locationId
    ? and(eq(inventoryBalances.organizationId, organizationId), eq(inventoryBalances.locationId, locationId))
    : eq(inventoryBalances.organizationId, organizationId);

  const [ledgerRows, poUpdatedRows, pendingPoRows, lowStockRows, flaggedRows] = await Promise.all([
    db.select({ value: max(stockMovements.id) }).from(stockMovements).where(movementScope),
    db
      .select({ value: max(purchaseOrders.updatedAt) })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.organizationId, organizationId)),
    db
      .select({ value: count() })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.organizationId, organizationId), eq(purchaseOrders.status, 'SUBMITTED'))),
    db
      .select({ value: count() })
      .from(inventoryBalances)
      .innerJoin(productVariants, eq(inventoryBalances.productVariantId, productVariants.id))
      .where(and(balanceScope, lte(inventoryBalances.availableQty, productVariants.reorderPoint))),
    db
      .select({ value: count() })
      .from(stockAdjustments)
      .where(
        and(
          eq(stockAdjustments.organizationId, organizationId),
          eq(stockAdjustments.isSuspicious, true),
          isNull(stockAdjustments.reviewedAt),
        ),
      ),
  ]);

  const latestLedgerId = ledgerRows[0]?.value ?? 0;
  const poUpdatedAt = poUpdatedRows[0]?.value ?? null;

  return {
    latestLedgerId,
    latestPoUpdatedAt: poUpdatedAt ? poUpdatedAt.toISOString() : null,
    pendingPoApprovalCount: pendingPoRows[0]?.value ?? 0,
    lowStockCount: lowStockRows[0]?.value ?? 0,
    flaggedAdjustmentCount: flaggedRows[0]?.value ?? 0,
    hasChanges: sinceLedgerId !== undefined ? latestLedgerId > sinceLedgerId : true,
    serverTime: new Date().toISOString(),
  };
}

/** Deterministic dev/demo fallback when PostgreSQL is unreachable (never in prod). */
function fallbackPollData(sinceLedgerId: number | undefined): PollData {
  const latestLedgerId = 48;
  return {
    latestLedgerId,
    latestPoUpdatedAt: '2026-10-14T08:00:00.000Z',
    pendingPoApprovalCount: 1,
    lowStockCount: 4,
    flaggedAdjustmentCount: 2,
    hasChanges: sinceLedgerId !== undefined ? latestLedgerId > sinceLedgerId : true,
    serverTime: new Date().toISOString(),
  };
}

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const parsed = pollQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return jsonError(400, 'VALIDATION_ERROR', 'Invalid sync query.', ctx.correlationId, parsed.error.issues);
  }

  const locationId =
    parsed.data.locationId && parsed.data.locationId !== 'ALL' ? parsed.data.locationId : null;
  const { sinceLedgerId } = parsed.data;

  try {
    const data = await loadPollData(ctx.organizationId, locationId, sinceLedgerId);
    return NextResponse.json({ data, meta: { correlationId: ctx.correlationId } });
  } catch (error) {
    if (getPublicEnv().NEXT_PUBLIC_APP_ENV === 'prod') throw error;
    console.warn('[sync/poll] PostgreSQL unavailable — serving demo fallback data.');
    return NextResponse.json({
      data: fallbackPollData(sinceLedgerId),
      meta: { correlationId: ctx.correlationId },
    });
  }
});
