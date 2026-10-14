import { and, asc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { getPublicEnv } from '@/lib/env';
import { calculateGrossMarginBps } from '@/lib/money';
import { createProductVariantSchema, productCatalogFilterSchema, type ReorderStatus } from '@/lib/validators/product.schema';
import { db } from '@/server/db';
import { inventoryBalances, productVariants, products, suppliers } from '@/server/db/schema';
import { AuditService } from '@/server/services/audit.service';
import { jsonError, withAuth } from '@/server/middleware/with-auth';
import { withIdempotency } from '@/server/middleware/with-idempotency';
import { withRbac } from '@/server/middleware/with-rbac';

export interface CatalogRow {
  id: string;
  sku: string;
  barcodeUpc: string | null;
  variantName: string;
  productName: string;
  brand: string;
  category: string;
  attributes: Record<string, string>;
  currency: string;
  imageUrl: string | null;
  unitCostCents: number | null;
  sellingPriceCents: number;
  marginBps: number | null;
  reorderPoint: number;
  isActive: boolean;
  supplierId: string;
  supplierName: string;
  leadTimeDays: number;
  onHandQty: number;
  reservedQty: number;
  availableQty: number;
  reorderStatus: ReorderStatus;
  updatedAt: string;
}

const COST_VISIBLE_ROLES = ['OWNER', 'MANAGER', 'PROCUREMENT_OFFICER', 'AUDITOR'];

function deriveReorderStatus(isActive: boolean, availableQty: number, reorderPoint: number): ReorderStatus {
  if (!isActive) return 'DISCONTINUED';
  if (availableQty <= 0) return 'OUT_OF_STOCK';
  if (availableQty <= reorderPoint) return 'LOW_STOCK';
  return 'IN_STOCK';
}

async function loadCatalog(
  organizationId: string,
  role: string,
  filter: ReturnType<typeof productCatalogFilterSchema.parse>,
): Promise<{ rows: CatalogRow[]; total: number }> {
  const locationId = filter.locationId && filter.locationId !== 'ALL' ? filter.locationId : null;
  const showCost = COST_VISIBLE_ROLES.includes(role);

  const balanceWhere = locationId
    ? and(eq(inventoryBalances.organizationId, organizationId), eq(inventoryBalances.locationId, locationId))
    : eq(inventoryBalances.organizationId, organizationId);

  const balanceAgg = db
    .select({
      productVariantId: inventoryBalances.productVariantId,
      onHandQty: sql<number>`coalesce(sum(${inventoryBalances.onHandQty}), 0)::int`.as('on_hand_qty'),
      reservedQty: sql<number>`coalesce(sum(${inventoryBalances.reservedQty}), 0)::int`.as('reserved_qty'),
    })
    .from(inventoryBalances)
    .where(balanceWhere)
    .groupBy(inventoryBalances.productVariantId)
    .as('balance_agg');

  const conditions: SQL[] = [eq(productVariants.organizationId, organizationId)];
  if (filter.category) conditions.push(eq(products.category, filter.category));
  if (filter.supplierId) conditions.push(eq(productVariants.primarySupplierId, filter.supplierId));
  if (filter.search) {
    const term = `%${filter.search}%`;
    const searchClause = or(
      ilike(productVariants.sku, term),
      ilike(productVariants.variantName, term),
      ilike(products.name, term),
      ilike(productVariants.barcodeUpc, term),
    );
    if (searchClause) conditions.push(searchClause);
  }

  const rawRows = await db
    .select({
      id: productVariants.id,
      sku: productVariants.sku,
      barcodeUpc: productVariants.barcodeUpc,
      variantName: productVariants.variantName,
      productName: products.name,
      brand: products.brand,
      category: products.category,
      attributes: productVariants.attributes,
      currency: productVariants.currency,
      imageUrl: products.imageUrl,
      unitCostCents: productVariants.unitCostCents,
      sellingPriceCents: productVariants.sellingPriceCents,
      reorderPoint: productVariants.reorderPoint,
      isActive: productVariants.isActive,
      supplierId: suppliers.id,
      supplierName: suppliers.name,
      leadTimeDays: suppliers.leadTimeDays,
      onHandQty: balanceAgg.onHandQty,
      reservedQty: balanceAgg.reservedQty,
      updatedAt: productVariants.updatedAt,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .innerJoin(suppliers, eq(productVariants.primarySupplierId, suppliers.id))
    .leftJoin(balanceAgg, eq(balanceAgg.productVariantId, productVariants.id))
    .where(and(...conditions))
    .orderBy(asc(productVariants.sku));

  let rows: CatalogRow[] = rawRows.map((row) => {
    const onHandQty = Number(row.onHandQty ?? 0);
    const reservedQty = Number(row.reservedQty ?? 0);
    const availableQty = onHandQty - reservedQty;
    return {
      id: row.id,
      sku: row.sku,
      barcodeUpc: row.barcodeUpc,
      variantName: row.variantName,
      productName: row.productName,
      brand: row.brand,
      category: row.category,
      attributes: (row.attributes ?? {}) as Record<string, string>,
      currency: row.currency,
      imageUrl: row.imageUrl,
      unitCostCents: showCost ? Number(row.unitCostCents) : null,
      sellingPriceCents: Number(row.sellingPriceCents),
      marginBps: showCost ? calculateGrossMarginBps(Number(row.unitCostCents), Number(row.sellingPriceCents)) : null,
      reorderPoint: row.reorderPoint,
      isActive: row.isActive,
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      leadTimeDays: row.leadTimeDays,
      onHandQty,
      reservedQty,
      availableQty,
      reorderStatus: deriveReorderStatus(row.isActive, availableQty, row.reorderPoint),
      updatedAt: row.updatedAt.toISOString(),
    };
  });

  if (filter.reorderStatus !== 'ALL') {
    rows = rows.filter((row) => row.reorderStatus === filter.reorderStatus);
  }

  const direction = filter.sortOrder === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    const pick = (row: CatalogRow): string | number => {
      switch (filter.sortBy) {
        case 'variantName':
          return row.variantName;
        case 'category':
          return row.category;
        case 'unitCostCents':
          return row.unitCostCents ?? 0;
        case 'sellingPriceCents':
          return row.sellingPriceCents;
        case 'availableQty':
          return row.availableQty;
        case 'updatedAt':
          return row.updatedAt;
        default:
          return row.sku;
      }
    };
    const left = pick(a);
    const right = pick(b);
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
    return String(left).localeCompare(String(right)) * direction;
  });

  const total = rows.length;
  const start = (filter.page - 1) * filter.pageSize;
  return { rows: rows.slice(start, start + filter.pageSize), total };
}

const FALLBACK_CATALOG: CatalogRow[] = [
  {
    id: 'f0000000-0000-4000-8000-000000000001', sku: 'GPU-NV-4090-24G', barcodeUpc: '0194645115643',
    variantName: 'ASUS TUF RTX 4090 24GB', productName: 'ASUS TUF RTX 4090 24GB', brand: 'ASUS', category: 'GPUs',
    attributes: { vram: '24GB' }, currency: 'USD', imageUrl: null, unitCostCents: 165000, sellingPriceCents: 189999,
    marginBps: 1315, reorderPoint: 5, isActive: true, supplierId: 'a0000000-0000-4000-8000-000000000303',
    supplierName: 'GlobalGPU Direct', leadTimeDays: 10, onHandQty: 33, reservedQty: 0, availableQty: 33,
    reorderStatus: 'IN_STOCK', updatedAt: '2026-10-14T08:00:00.000Z',
  },
  {
    id: 'f0000000-0000-4000-8000-000000000002', sku: 'CPU-AMD-7800X3D', barcodeUpc: '0730143314482',
    variantName: 'AMD Ryzen 7 7800X3D', productName: 'AMD Ryzen 7 7800X3D', brand: 'AMD', category: 'CPUs',
    attributes: { cores: '8' }, currency: 'USD', imageUrl: null, unitCostCents: 34000, sellingPriceCents: 39999,
    marginBps: 1500, reorderPoint: 5, isActive: true, supplierId: 'a0000000-0000-4000-8000-000000000301',
    supplierName: 'TechDistro Inc.', leadTimeDays: 5, onHandQty: 3, reservedQty: 0, availableQty: 3,
    reorderStatus: 'LOW_STOCK', updatedAt: '2026-10-14T08:00:00.000Z',
  },
];

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const parsed = productCatalogFilterSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return jsonError(400, 'VALIDATION_ERROR', 'Invalid catalog query.', ctx.correlationId, parsed.error.issues);
  }

  try {
    const { rows, total } = await loadCatalog(ctx.organizationId, ctx.role, parsed.data);
    return NextResponse.json({
      data: rows,
      meta: {
        correlationId: ctx.correlationId,
        total,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        viewerRole: ctx.role,
      },
    });
  } catch (error) {
    if (getPublicEnv().NEXT_PUBLIC_APP_ENV === 'prod') throw error;
    console.warn('[products] PostgreSQL unavailable — serving demo fallback catalog.');
    const showCost = COST_VISIBLE_ROLES.includes(ctx.role);
    const rows = showCost ? FALLBACK_CATALOG : FALLBACK_CATALOG.map((row) => ({ ...row, unitCostCents: null, marginBps: null }));
    return NextResponse.json({
      data: rows,
      meta: {
        correlationId: ctx.correlationId,
        total: rows.length,
        page: 1,
        pageSize: rows.length,
        viewerRole: ctx.role,
      },
    });
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

    const parsed = createProductVariantSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, 'VALIDATION_ERROR', 'Invalid product payload.', ctx.correlationId, parsed.error.issues);
    }
    const input = parsed.data;

    const created = await db.transaction(async (tx) => {
      const [product] = await tx
        .insert(products)
        .values({
          organizationId: ctx.organizationId,
          name: input.productName,
          brand: input.brand,
          category: input.category,
          imageUrl: input.imageUrl ?? null,
        })
        .returning();

      const [variant] = await tx
        .insert(productVariants)
        .values({
          organizationId: ctx.organizationId,
          productId: product.id,
          primarySupplierId: input.primarySupplierId,
          sku: input.sku,
          barcodeUpc: input.barcodeUpc ?? null,
          variantName: input.variantName,
          attributes: input.attributes ?? {},
          currency: input.currency,
          unitCostCents: input.unitCostCents,
          sellingPriceCents: input.sellingPriceCents,
          reorderPoint: input.reorderPoint,
          reorderQty: input.reorderQty,
        })
        .returning();

      await AuditService.record(tx, {
        organizationId: ctx.organizationId,
        actorMemberId: ctx.memberId,
        actorRole: ctx.role,
        action: 'PRODUCT_VARIANT_CREATED',
        entityType: 'product_variants',
        entityId: variant.id,
        afterState: { sku: variant.sku, unitCostCents: variant.unitCostCents, sellingPriceCents: variant.sellingPriceCents },
        correlationId: ctx.correlationId,
      });

      return variant;
    });

    return NextResponse.json({ data: created, meta: { correlationId: ctx.correlationId } }, { status: 201 });
  }),
);
