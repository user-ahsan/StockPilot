import { describe, expect, it, vi } from 'vitest';
import { InMemoryCommerceStore } from '../../src/server/services/inventory-ledger.service';
import {
  SalesOversellConflictError,
  SalesOrderService,
} from '../../src/server/services/sales-order.service';

// `server-only` throws outside a React Server bundle — neutralise it for tests.
vi.mock('server-only', () => ({}));

const ORG = 'org-1';
const LOC = 'loc-1';
const VARIANT = 'variant-1';
const SKU = 'CPU-TEST-7800X3D';

const ACTOR = { memberId: 'rep-1', role: 'SALES_ASSOCIATE' as const, correlationId: 'corr-so' };

function makeStore(onHandQty = 2): InMemoryCommerceStore {
  const store = new InMemoryCommerceStore();
  store.seedOrganizationThresholds(ORG, { suspiciousAdjThresholdCents: 50_000, suspiciousAdjPctBps: 1_000 });
  store.seedVariant({
    id: VARIANT,
    organizationId: ORG,
    sku: SKU,
    variantName: 'AMD Ryzen 7 7800X3D',
    reorderPoint: 1,
    currency: 'USD',
    unitCostCents: 34_000,
    sellingPriceCents: 39_999,
  });
  store.seedBalance({ organizationId: ORG, locationId: LOC, productVariantId: VARIANT, onHandQty, reservedQty: 0 });
  return store;
}

function sell(store: InMemoryCommerceStore, actor: typeof ACTOR = ACTOR, quantity = 1) {
  return store.runExclusive((s) =>
    SalesOrderService.createAndConfirmSalesOrder(s, ORG, actor, {
      locationId: LOC,
      customerName: 'Acme Studios LLC',
      currency: 'USD',
      taxRateBps: 0,
      discountCents: 0,
      confirmImmediately: true,
      items: [{ productVariantId: VARIANT, quantity }],
    }),
  );
}

describe('Concurrent sales oversell protection (Rule 148)', () => {
  it('Test 1 — 5 reps competing for the last 2 units: exactly 2 win, 3 are blocked', async () => {
    const store = makeStore(2);

    const results = await Promise.allSettled([sell(store), sell(store), sell(store), sell(store), sell(store)]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(3);
    for (const result of fulfilled) {
      if (result.status === 'fulfilled') expect(result.value.status).toBe('CONFIRMED');
    }

    for (const result of rejected) {
      const failure = result.status === 'rejected' ? result.reason : null;
      expect(failure).toBeInstanceOf(SalesOversellConflictError);
      const conflict = failure as SalesOversellConflictError;
      expect(conflict.code).toBe('INSUFFICIENT_AVAILABLE_STOCK');
      expect(conflict.status).toBe(409);
      expect(conflict.details.availableQty).toBe(0);
      expect(conflict.details.requestedQty).toBe(1);
    }

    const balance = store.getBalance(LOC, VARIANT);
    expect(balance?.onHandQty).toBe(2);
    expect(balance?.reservedQty).toBe(2);
    expect((balance?.onHandQty ?? 0) - (balance?.reservedQty ?? 0)).toBe(0);
  });

  it('Test 2 — atomic fulfillment and cancellation release', async () => {
    const store = makeStore(2);

    const first = await sell(store);
    const second = await sell(store);

    // Fulfil the first order: reserved AND on-hand both drop by 1.
    const fulfilled = await store.runExclusive((s) =>
      SalesOrderService.fulfillSalesOrder(s, ORG, first.id, ACTOR, 'Dispatched'),
    );
    expect(fulfilled.status).toBe('FULFILLED');

    const fulfillmentMovements = store.movements().filter((movement) => movement.movementType === 'SALE_FULFILLMENT');
    expect(fulfillmentMovements).toHaveLength(1);
    expect(fulfillmentMovements[0].quantityDelta).toBe(-1);

    let balance = store.getBalance(LOC, VARIANT);
    expect(balance?.onHandQty).toBe(1);
    expect(balance?.reservedQty).toBe(1);
    expect((balance?.onHandQty ?? 0) - (balance?.reservedQty ?? 0)).toBe(0);

    // Cancel the second order: the reservation is released.
    const cancelled = await store.runExclusive((s) =>
      SalesOrderService.cancelSalesOrder(s, ORG, second.id, ACTOR, 'Customer changed their mind'),
    );
    expect(cancelled.status).toBe('CANCELLED');

    balance = store.getBalance(LOC, VARIANT);
    expect(balance?.onHandQty).toBe(1);
    expect(balance?.reservedQty).toBe(0);
    expect((balance?.onHandQty ?? 0) - (balance?.reservedQty ?? 0)).toBe(1);

    // The freed unit can now be sold.
    const resale = await sell(store);
    expect(resale.status).toBe('CONFIRMED');
    balance = store.getBalance(LOC, VARIANT);
    expect(balance?.reservedQty).toBe(1);
    expect((balance?.onHandQty ?? 0) - (balance?.reservedQty ?? 0)).toBe(0);
  });

  it('rejects a customer discount for non-management roles', async () => {
    const store = makeStore(2);
    await expect(
      store.runExclusive((s) =>
        SalesOrderService.createAndConfirmSalesOrder(s, ORG, ACTOR, {
          locationId: LOC,
          customerName: 'Acme Studios LLC',
          currency: 'USD',
          taxRateBps: 0,
          discountCents: 500,
          confirmImmediately: true,
          items: [{ productVariantId: VARIANT, quantity: 1 }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'DISCOUNT_REQUIRES_MANAGER' });
    expect(store.getBalance(LOC, VARIANT)?.reservedQty).toBe(0);
  });
});
