import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getPublicEnv } from '@/lib/env';
import { db } from '@/server/db';
import {
  inventoryBalances,
  locations,
  members,
  productVariants,
  products,
  purchaseOrders,
  stockMovements,
} from '@/server/db/schema';
import { jsonError, withAuth } from '@/server/middleware/with-auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANGE_DAYS = { today: 1, '7d': 7, '30d': 30, '90d': 90 } as const;

const overviewQuerySchema = z
  .object({
    locationId: z
      .string()
      .refine((value) => value === 'ALL' || UUID_RE.test(value), 'locationId must be "ALL" or a UUID')
      .optional(),
    range: z.enum(['today', '7d', '30d', '90d']).default('30d'),
    category: z.string().min(1).optional(),
  })
  .strict();

const num = (value: string | number | null | undefined): number => Number(value ?? 0);

interface OverviewResponse {
  kpis: {
    totalActiveSkus: number;
    discontinuedSkus: number;
    totalValuationCents: number;
    currency: 'USD';
    valuationChangeBps: number;
    lowStockCount: number;
    outOfStockCount: number;
    pendingPoCount: number;
    pendingPoValueCents: number;
  };
  velocitySeries: VelocityBucket[];
  categoryValuation: CategoryValuation[];
  recentMovements: RecentMovement[];
}

interface VelocityBucket {
  date: string;
  inboundUnits: number;
  inboundValueCents: number;
  outboundUnits: number;
  outboundValueCents: number;
  adjustmentUnits: number;
  adjustmentValueCents: number;
  netDeltaUnits: number;
  topMovingSku: string | null;
  currency: 'USD';
}

interface CategoryValuation {
  category: string;
  valuationCents: number;
  shareBps: number;
  totalUnits: number;
  skuCount: number;
  lowStockSkuCount: number;
  currency: 'USD';
}

interface RecentMovement {
  id: number;
  createdAt: string;
  sku: string;
  variantName: string;
  locationCode: string;
  locationName: string;
  movementType: string;
  quantityDelta: number;
  balanceBefore: number;
  balanceAfter: number;
  unitCostCents: number;
  currency: string;
  referenceType: string;
  referenceId: string;
  actorName: string;
  actorRole: string;
}

function startOfRange(days: number): Date {
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return from;
}

async function loadOverview(
  organizationId: string,
  locationId: string | null,
  rangeKey: keyof typeof RANGE_DAYS,
  category: string | undefined,
): Promise<OverviewResponse> {
  const days = RANGE_DAYS[rangeKey];
  const fromDate = startOfRange(days);

  const movementScope = locationId
    ? and(eq(stockMovements.organizationId, organizationId), eq(stockMovements.locationId, locationId))
    : eq(stockMovements.organizationId, organizationId);
  const balanceScope = locationId
    ? and(eq(inventoryBalances.organizationId, organizationId), eq(inventoryBalances.locationId, locationId))
    : eq(inventoryBalances.organizationId, organizationId);
  const variantScope = category
    ? and(eq(productVariants.organizationId, organizationId), eq(products.category, category))
    : eq(productVariants.organizationId, organizationId);

  const pendingStatuses = ['SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED'] as const;

  const [activeSkus, discontinuedSkus, valuation, lowStock, outOfStock, pendingPos] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(and(variantScope, eq(productVariants.isActive, true))),
      db
        .select({ value: count() })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(and(variantScope, eq(productVariants.isActive, false))),
      db
        .select({
          value: sql<string>`coalesce(sum(${inventoryBalances.onHandQty} * ${productVariants.unitCostCents}), 0)::bigint`,
        })
        .from(inventoryBalances)
        .innerJoin(productVariants, eq(inventoryBalances.productVariantId, productVariants.id))
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(and(balanceScope, variantScope)),
      db
        .select({ value: count() })
        .from(inventoryBalances)
        .innerJoin(productVariants, eq(inventoryBalances.productVariantId, productVariants.id))
        .where(
          and(
            balanceScope,
            eq(productVariants.organizationId, organizationId),
            sql`${inventoryBalances.availableQty} > 0`,
            sql`${inventoryBalances.availableQty} <= ${productVariants.reorderPoint}`,
          ),
        ),
      db
        .select({ value: count() })
        .from(inventoryBalances)
        .innerJoin(productVariants, eq(inventoryBalances.productVariantId, productVariants.id))
        .where(
          and(
            balanceScope,
            eq(productVariants.organizationId, organizationId),
            sql`${inventoryBalances.availableQty} <= 0`,
          ),
        ),
      db
        .select({
          value: count(),
          totalCents: sql<string>`coalesce(sum(${purchaseOrders.totalCents}), 0)::bigint`,
        })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.organizationId, organizationId),
            inArray(purchaseOrders.status, [...pendingStatuses]),
          ),
        ),
    ]);

  // Velocity buckets
  const dayExpr = sql<string>`to_char(${stockMovements.createdAt}, 'YYYY-MM-DD')`;
  const velocityRows = await db
    .select({
      day: dayExpr,
      movementType: stockMovements.movementType,
      units: sql<number>`coalesce(sum(${stockMovements.quantityDelta}), 0)::int`,
      valueCents: sql<string>`coalesce(sum(${stockMovements.quantityDelta} * ${stockMovements.unitCostCents}), 0)::bigint`,
    })
    .from(stockMovements)
    .where(and(movementScope, gte(stockMovements.createdAt, fromDate)))
    .groupBy(dayExpr, stockMovements.movementType);

  const moverRows = await db
    .select({
      day: dayExpr,
      sku: productVariants.sku,
      moved: sql<number>`coalesce(sum(abs(${stockMovements.quantityDelta})), 0)::int`,
    })
    .from(stockMovements)
    .innerJoin(productVariants, eq(stockMovements.productVariantId, productVariants.id))
    .where(and(movementScope, gte(stockMovements.createdAt, fromDate)))
    .groupBy(dayExpr, productVariants.sku);

  const buckets = new Map<string, VelocityBucket>();
  for (let offset = 0; offset < days; offset++) {
    const day = new Date(fromDate);
    day.setUTCDate(fromDate.getUTCDate() + offset);
    const key = day.toISOString().slice(0, 10);
    buckets.set(key, {
      date: key,
      inboundUnits: 0,
      inboundValueCents: 0,
      outboundUnits: 0,
      outboundValueCents: 0,
      adjustmentUnits: 0,
      adjustmentValueCents: 0,
      netDeltaUnits: 0,
      topMovingSku: null,
      currency: 'USD',
    });
  }

  for (const row of velocityRows) {
    const bucket = buckets.get(row.day);
    if (!bucket) continue;
    const units = Number(row.units);
    const value = Math.abs(num(row.valueCents));
    if (row.movementType === 'PO_RECEIPT' || row.movementType === 'TRANSFER_IN' || row.movementType === 'ADJUSTMENT_POSITIVE') {
      bucket.inboundUnits += Math.abs(units);
      bucket.inboundValueCents += value;
    } else if (row.movementType === 'SALE_FULFILLMENT' || row.movementType === 'TRANSFER_OUT') {
      bucket.outboundUnits += Math.abs(units);
      bucket.outboundValueCents += value;
    } else if (row.movementType === 'ADJUSTMENT_NEGATIVE') {
      bucket.adjustmentUnits += Math.abs(units);
      bucket.adjustmentValueCents += value;
    }
  }

  const bestMover = new Map<string, { sku: string; moved: number }>();
  for (const row of moverRows) {
    const current = bestMover.get(row.day);
    if (!current || Number(row.moved) > current.moved) {
      bestMover.set(row.day, { sku: row.sku, moved: Number(row.moved) });
    }
  }
  for (const [day, mover] of bestMover) {
    const bucket = buckets.get(day);
    if (bucket) bucket.topMovingSku = mover.sku;
  }
  for (const bucket of buckets.values()) {
    bucket.netDeltaUnits = bucket.inboundUnits - bucket.outboundUnits - bucket.adjustmentUnits;
  }
  const velocitySeries = [...buckets.values()];

  // Category valuation
  const categoryRows = await db
    .select({
      category: products.category,
      valuationCents: sql<string>`coalesce(sum(${inventoryBalances.onHandQty} * ${productVariants.unitCostCents}), 0)::bigint`,
      totalUnits: sql<number>`coalesce(sum(${inventoryBalances.onHandQty}), 0)::int`,
      skuCount: sql<number>`count(distinct ${productVariants.id})::int`,
      lowStockSkuCount: sql<number>`count(distinct case when ${inventoryBalances.availableQty} > 0 and ${inventoryBalances.availableQty} <= ${productVariants.reorderPoint} then ${productVariants.id} end)::int`,
    })
    .from(inventoryBalances)
    .innerJoin(productVariants, eq(inventoryBalances.productVariantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(balanceScope, eq(productVariants.organizationId, organizationId)))
    .groupBy(products.category);

  const totalValuation = categoryRows.reduce((sum, row) => sum + num(row.valuationCents), 0);
  const categoryValuation: CategoryValuation[] = categoryRows
    .map((row) => ({
      category: row.category,
      valuationCents: num(row.valuationCents),
      shareBps: totalValuation > 0 ? Math.round((num(row.valuationCents) / totalValuation) * 10_000) : 0,
      totalUnits: Number(row.totalUnits),
      skuCount: Number(row.skuCount),
      lowStockSkuCount: Number(row.lowStockSkuCount),
      currency: 'USD' as const,
    }))
    .sort((a, b) => b.valuationCents - a.valuationCents);

  // Recent movements
  const movementRows = await db
    .select({
      id: stockMovements.id,
      createdAt: stockMovements.createdAt,
      sku: productVariants.sku,
      variantName: productVariants.variantName,
      locationCode: locations.code,
      locationName: locations.name,
      movementType: stockMovements.movementType,
      quantityDelta: stockMovements.quantityDelta,
      balanceBefore: stockMovements.balanceBefore,
      balanceAfter: stockMovements.balanceAfter,
      unitCostCents: stockMovements.unitCostCents,
      currency: stockMovements.currency,
      referenceType: stockMovements.referenceType,
      referenceId: stockMovements.referenceId,
      actorName: members.fullName,
      actorRole: members.role,
    })
    .from(stockMovements)
    .innerJoin(productVariants, eq(stockMovements.productVariantId, productVariants.id))
    .innerJoin(locations, eq(stockMovements.locationId, locations.id))
    .innerJoin(members, eq(stockMovements.actorMemberId, members.id))
    .where(movementScope)
    .orderBy(desc(stockMovements.id))
    .limit(25);

  const recentMovements: RecentMovement[] = movementRows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    kpis: {
      totalActiveSkus: activeSkus[0]?.value ?? 0,
      discontinuedSkus: discontinuedSkus[0]?.value ?? 0,
      totalValuationCents: num(valuation[0]?.value),
      currency: 'USD',
      valuationChangeBps: 0, // ponytail: no snapshot history yet; wire to daily snapshots later
      lowStockCount: lowStock[0]?.value ?? 0,
      outOfStockCount: outOfStock[0]?.value ?? 0,
      pendingPoCount: pendingPos[0]?.value ?? 0,
      pendingPoValueCents: num(pendingPos[0]?.totalCents),
    },
    velocitySeries,
    categoryValuation,
    recentMovements,
  };
}

/** Deterministic dev/demo fallback when PostgreSQL is unreachable (never in prod). */
function fallbackOverview(rangeKey: keyof typeof RANGE_DAYS): OverviewResponse {
  const days = RANGE_DAYS[rangeKey];
  const from = startOfRange(Math.min(days, 14));
  const velocitySeries: VelocityBucket[] = Array.from({ length: Math.min(days, 14) }, (_, index) => {
    const day = new Date(from);
    day.setUTCDate(from.getUTCDate() + index);
    return {
      date: day.toISOString().slice(0, 10),
      inboundUnits: 120,
      inboundValueCents: 1_840_000,
      outboundUnits: 85,
      outboundValueCents: 2_975_000,
      adjustmentUnits: 2,
      adjustmentValueCents: 34_000,
      netDeltaUnits: 33,
      topMovingSku: 'GPU-NV-4090-24G',
      currency: 'USD',
    };
  });

  return {
    kpis: {
      totalActiveSkus: 24,
      discontinuedSkus: 0,
      totalValuationCents: 28_491_050,
      currency: 'USD',
      valuationChangeBps: 0,
      lowStockCount: 4,
      outOfStockCount: 0,
      pendingPoCount: 1,
      pendingPoValueCents: 1_645_000,
    },
    velocitySeries,
    categoryValuation: [
      { category: 'GPUs', valuationCents: 9_420_000, shareBps: 3306, totalUnits: 412, skuCount: 5, lowStockSkuCount: 1, currency: 'USD' },
      { category: 'CPUs', valuationCents: 7_150_000, shareBps: 2510, totalUnits: 260, skuCount: 4, lowStockSkuCount: 1, currency: 'USD' },
      { category: 'Storage', valuationCents: 4_980_000, shareBps: 1748, totalUnits: 340, skuCount: 4, lowStockSkuCount: 1, currency: 'USD' },
      { category: 'Memory', valuationCents: 3_920_000, shareBps: 1376, totalUnits: 300, skuCount: 4, lowStockSkuCount: 1, currency: 'USD' },
      { category: 'Power Supplies', valuationCents: 3_021_050, shareBps: 1060, totalUnits: 210, skuCount: 3, lowStockSkuCount: 0, currency: 'USD' },
    ],
    recentMovements: [
      {
        id: 48,
        createdAt: '2026-10-14T08:00:00.000Z',
        sku: 'GPU-NV-4090-24G',
        variantName: 'ASUS TUF RTX 4090 24GB',
        locationCode: 'WH-CENTRAL',
        locationName: 'Main Warehouse — Austin',
        movementType: 'PO_RECEIPT',
        quantityDelta: 25,
        balanceBefore: 33,
        balanceAfter: 58,
        unitCostCents: 165000,
        currency: 'USD',
        referenceType: 'PURCHASE_ORDER',
        referenceId: 'a0000000-0000-4000-8000-000000000401',
        actorName: 'Carlos Clerk',
        actorRole: 'WAREHOUSE_CLERK',
      },
    ],
  };
}

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const parsed = overviewQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return jsonError(400, 'VALIDATION_ERROR', 'Invalid overview query.', ctx.correlationId, parsed.error.issues);
  }

  const locationId =
    parsed.data.locationId && parsed.data.locationId !== 'ALL' ? parsed.data.locationId : null;
  const { range, category } = parsed.data;

  try {
    const data = await loadOverview(ctx.organizationId, locationId, range, category);
    return NextResponse.json({ data, meta: { correlationId: ctx.correlationId } });
  } catch (error) {
    if (getPublicEnv().NEXT_PUBLIC_APP_ENV === 'prod') throw error;
    console.warn('[overview] PostgreSQL unavailable — serving demo fallback data.');
    return NextResponse.json({
      data: fallbackOverview(range),
      meta: { correlationId: ctx.correlationId },
    });
  }
});
