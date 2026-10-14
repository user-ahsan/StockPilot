import { and, asc, desc, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { getPublicEnv } from '@/lib/env';
import { calculateGrossMarginBps } from '@/lib/money';
import {
  findStockQuantityKey,
  updateProductVariantSchema,
  UUID_RE,
} from '@/lib/validators/product.schema';
import { db } from '@/server/db';
import {
  inventoryBalances,
  locations,
  members,
  productVariants,
  products,
  stockMovements,
  suppliers,
} from '@/server/db/schema';
import { AuditService } from '@/server/services/audit.service';
import { jsonError, withAuth } from '@/server/middleware/with-auth';
import { withRbac } from '@/server/middleware/with-rbac';

/** withAuth/withRbac drop Next's route context, so read the id from the path. */
function variantIdFrom(req: NextRequest): string | null {
  const segments = req.nextUrl.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  return last && UUID_RE.test(last) ? last : null;
}

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const variantId = variantIdFrom(req);
  if (!variantId) {
    return jsonError(400, 'INVALID_VARIANT_ID', 'A valid variantId is required.', ctx.correlationId);
  }

  try {
    const [row] = await db
      .select({
        id: productVariants.id,
        sku: productVariants.sku,
        barcodeUpc: productVariants.barcodeUpc,
        variantName: productVariants.variantName,
        attributes: productVariants.attributes,
        currency: productVariants.currency,
        unitCostCents: productVariants.unitCostCents,
        sellingPriceCents: productVariants.sellingPriceCents,
        reorderPoint: productVariants.reorderPoint,
        reorderQty: productVariants.reorderQty,
        isActive: productVariants.isActive,
        productName: products.name,
        brand: products.brand,
        category: products.category,
        imageUrl: products.imageUrl,
        supplierId: suppliers.id,
        supplierName: suppliers.name,
        leadTimeDays: suppliers.leadTimeDays,
        updatedAt: productVariants.updatedAt,
      })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .innerJoin(suppliers, eq(productVariants.primarySupplierId, suppliers.id))
      .where(and(eq(productVariants.id, variantId), eq(productVariants.organizationId, ctx.organizationId)))
      .limit(1);

    if (!row) {
      return jsonError(404, 'VARIANT_NOT_FOUND', 'Product variant not found.', ctx.correlationId);
    }

    const balances = await db
      .select({
        locationId: inventoryBalances.locationId,
        locationCode: locations.code,
        locationName: locations.name,
        onHandQty: inventoryBalances.onHandQty,
        reservedQty: inventoryBalances.reservedQty,
        availableQty: inventoryBalances.availableQty,
        updatedAt: inventoryBalances.updatedAt,
      })
      .from(inventoryBalances)
      .innerJoin(locations, eq(inventoryBalances.locationId, locations.id))
      .where(
        and(
          eq(inventoryBalances.organizationId, ctx.organizationId),
          eq(inventoryBalances.productVariantId, variantId),
        ),
      )
      .orderBy(asc(locations.code));

    const movements = await db
      .select({
        id: stockMovements.id,
        createdAt: stockMovements.createdAt,
        movementType: stockMovements.movementType,
        quantityDelta: stockMovements.quantityDelta,
        balanceBefore: stockMovements.balanceBefore,
        balanceAfter: stockMovements.balanceAfter,
        unitCostCents: stockMovements.unitCostCents,
        currency: stockMovements.currency,
        referenceType: stockMovements.referenceType,
        referenceId: stockMovements.referenceId,
        locationCode: locations.code,
        actorName: members.fullName,
        actorRole: members.role,
      })
      .from(stockMovements)
      .innerJoin(locations, eq(stockMovements.locationId, locations.id))
      .innerJoin(members, eq(stockMovements.actorMemberId, members.id))
      .where(
        and(
          eq(stockMovements.organizationId, ctx.organizationId),
          eq(stockMovements.productVariantId, variantId),
        ),
      )
      .orderBy(desc(stockMovements.id))
      .limit(50);

    const totalOnHand = balances.reduce((sum, balance) => sum + balance.onHandQty, 0);
    const totalReserved = balances.reduce((sum, balance) => sum + balance.reservedQty, 0);

    return NextResponse.json({
      data: {
        variant: {
          ...row,
          updatedAt: row.updatedAt.toISOString(),
          marginBps: calculateGrossMarginBps(Number(row.unitCostCents), Number(row.sellingPriceCents)),
        },
        totals: { onHandQty: totalOnHand, reservedQty: totalReserved, availableQty: totalOnHand - totalReserved },
        balances: balances.map((balance) => ({
          ...balance,
          updatedAt: balance.updatedAt.toISOString(),
        })),
        movements: movements.map((movement) => ({
          ...movement,
          createdAt: movement.createdAt.toISOString(),
        })),
      },
      meta: { correlationId: ctx.correlationId },
    });
  } catch (error) {
    if (getPublicEnv().NEXT_PUBLIC_APP_ENV === 'prod') throw error;
    console.warn('[products/:variantId] PostgreSQL unavailable — serving demo fallback detail.');
    return NextResponse.json({
      data: {
        variant: {
          id: variantId,
          sku: 'GPU-NV-4090-24G',
          barcodeUpc: '0194645115643',
          variantName: 'ASUS TUF RTX 4090 24GB',
          attributes: { vram: '24GB' },
          currency: 'USD',
          unitCostCents: 165000,
          sellingPriceCents: 189999,
          reorderPoint: 5,
          reorderQty: 25,
          isActive: true,
          productName: 'ASUS TUF RTX 4090 24GB',
          brand: 'ASUS',
          category: 'GPUs',
          imageUrl: null,
          supplierId: 'a0000000-0000-4000-8000-000000000303',
          supplierName: 'GlobalGPU Direct',
          leadTimeDays: 10,
          updatedAt: '2026-10-14T08:00:00.000Z',
          marginBps: 1315,
        },
        totals: { onHandQty: 33, reservedQty: 0, availableQty: 33 },
        balances: [
          { locationId: 'a0000000-0000-4000-8000-000000000101', locationCode: 'WH-CENTRAL', locationName: 'Main Warehouse — Austin', onHandQty: 33, reservedQty: 0, availableQty: 33, updatedAt: '2026-10-14T08:00:00.000Z' },
        ],
        movements: [],
      },
      meta: { correlationId: ctx.correlationId },
    });
  }
});

export const PATCH = withRbac(
  ['OWNER', 'MANAGER', 'PROCUREMENT_OFFICER'],
  async (req: NextRequest, ctx) => {
    const variantId = variantIdFrom(req);
    if (!variantId) {
      return jsonError(400, 'INVALID_VARIANT_ID', 'A valid variantId is required.', ctx.correlationId);
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonError(400, 'INVALID_JSON', 'Request body must be valid JSON.', ctx.correlationId);
    }

    // Rules 061–062: reject any attempt to write stock balances via metadata.
    const forbiddenKey = findStockQuantityKey(raw);
    if (forbiddenKey) {
      return jsonError(
        400,
        'DIRECT_STOCK_MUTATION_FORBIDDEN',
        `"${forbiddenKey}" cannot be set here — stock balances only change via ledger transactions.`,
        ctx.correlationId,
      );
    }

    const parsed = updateProductVariantSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, 'VALIDATION_ERROR', 'Invalid variant update payload.', ctx.correlationId, parsed.error.issues);
    }
    const input = parsed.data;

    const [existing] = await db
      .select()
      .from(productVariants)
      .where(and(eq(productVariants.id, variantId), eq(productVariants.organizationId, ctx.organizationId)))
      .limit(1);

    if (!existing) {
      return jsonError(404, 'VARIANT_NOT_FOUND', 'Product variant not found.', ctx.correlationId);
    }

    // Rule 127: only OWNER/MANAGER may change cost or selling price.
    const touchesPrice = input.unitCostCents !== undefined || input.sellingPriceCents !== undefined;
    if (touchesPrice && ctx.role !== 'OWNER' && ctx.role !== 'MANAGER') {
      await AuditService.recordSecurityEvent({
        organizationId: ctx.organizationId,
        actorMemberId: ctx.memberId,
        actorRole: ctx.role,
        action: 'AUDIT_UNAUTHORIZED_PRICE_CHANGE_ATTEMPT',
        entityType: 'product_variants',
        entityId: variantId,
        beforeState: { unitCostCents: existing.unitCostCents, sellingPriceCents: existing.sellingPriceCents },
        afterState: { unitCostCents: input.unitCostCents, sellingPriceCents: input.sellingPriceCents },
        correlationId: ctx.correlationId,
        ipAddress: req.headers.get('x-forwarded-for'),
        userAgent: req.headers.get('user-agent'),
      });
      return jsonError(403, 'PRICE_CHANGE_REQUIRES_MANAGER', 'Changing cost or selling price requires the MANAGER or OWNER role.', ctx.correlationId);
    }

    const updated = await db.transaction(async (tx) => {
      const [variant] = await tx
        .update(productVariants)
        .set({
          ...(input.variantName !== undefined ? { variantName: input.variantName } : {}),
          ...(input.barcodeUpc !== undefined ? { barcodeUpc: input.barcodeUpc } : {}),
          ...(input.primarySupplierId !== undefined ? { primarySupplierId: input.primarySupplierId } : {}),
          ...(input.reorderPoint !== undefined ? { reorderPoint: input.reorderPoint } : {}),
          ...(input.reorderQty !== undefined ? { reorderQty: input.reorderQty } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.attributes !== undefined ? { attributes: input.attributes } : {}),
          ...(input.unitCostCents !== undefined ? { unitCostCents: input.unitCostCents } : {}),
          ...(input.sellingPriceCents !== undefined ? { sellingPriceCents: input.sellingPriceCents } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          updatedAt: new Date(),
        })
        .where(eq(productVariants.id, variantId))
        .returning();

      await AuditService.record(tx, {
        organizationId: ctx.organizationId,
        actorMemberId: ctx.memberId,
        actorRole: ctx.role,
        action: touchesPrice ? 'PRODUCT_PRICE_UPDATED' : 'PRODUCT_VARIANT_UPDATED',
        entityType: 'product_variants',
        entityId: variantId,
        beforeState: {
          unitCostCents: existing.unitCostCents,
          sellingPriceCents: existing.sellingPriceCents,
          variantName: existing.variantName,
          reorderPoint: existing.reorderPoint,
          reorderQty: existing.reorderQty,
          isActive: existing.isActive,
        },
        afterState: input,
        correlationId: ctx.correlationId,
      });

      return variant;
    });

    return NextResponse.json({ data: updated, meta: { correlationId: ctx.correlationId } });
  },
);
