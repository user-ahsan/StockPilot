import 'server-only';

/**
 * Deterministic row-locking helpers (Rules 076–081).
 *
 * Always lock rows in ascending `product_variant_id` order so two concurrent
 * transactions touching the same SKUs can never deadlock each other.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbTransaction } from './index';
import { inventoryBalances, purchaseOrderItems, purchaseOrders } from './schema';

export type InventoryBalanceRecord = typeof inventoryBalances.$inferSelect;
export type PurchaseOrderRecord = typeof purchaseOrders.$inferSelect;
export type PurchaseOrderItemRecord = typeof purchaseOrderItems.$inferSelect;

/** Deduplicate + sort UUIDs in strict lexicographical ascending order. */
export function sortVariantIdsDeterministically(variantIds: string[]): string[] {
  return [...new Set(variantIds)].sort((a, b) => a.localeCompare(b));
}

/**
 * Ensure a balance row exists for every variant, then lock them all
 * `FOR UPDATE` in deterministic order.
 */
export async function lockInventoryBalancesForUpdate(
  tx: DbTransaction,
  organizationId: string,
  locationId: string,
  variantIds: string[],
): Promise<InventoryBalanceRecord[]> {
  const ordered = sortVariantIdsDeterministically(variantIds);
  if (ordered.length === 0) return [];

  // Rule 080: create zero rows before locking on first receipt at a location.
  await tx
    .insert(inventoryBalances)
    .values(ordered.map((productVariantId) => ({ organizationId, locationId, productVariantId })))
    .onConflictDoNothing({
      target: [
        inventoryBalances.organizationId,
        inventoryBalances.locationId,
        inventoryBalances.productVariantId,
      ],
    });

  return tx
    .select()
    .from(inventoryBalances)
    .where(
      and(
        eq(inventoryBalances.organizationId, organizationId),
        eq(inventoryBalances.locationId, locationId),
        inArray(inventoryBalances.productVariantId, ordered),
      ),
    )
    .orderBy(asc(inventoryBalances.productVariantId))
    .for('update');
}

/**
 * Lock the parent PO header (Rule 076) and its line items sorted by
 * `product_variant_id ASC` (Rule 077) to serialise concurrent clerks.
 */
export async function lockPurchaseOrderForUpdate(
  tx: DbTransaction,
  organizationId: string,
  purchaseOrderId: string,
): Promise<{ purchaseOrder: PurchaseOrderRecord | undefined; items: PurchaseOrderItemRecord[] }> {
  const [purchaseOrder] = await tx
    .select()
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.organizationId, organizationId),
        eq(purchaseOrders.id, purchaseOrderId),
      ),
    )
    .for('update');

  const items = await tx
    .select()
    .from(purchaseOrderItems)
    .where(
      and(
        eq(purchaseOrderItems.organizationId, organizationId),
        eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId),
      ),
    )
    .orderBy(asc(purchaseOrderItems.productVariantId))
    .for('update');

  return { purchaseOrder, items };
}
