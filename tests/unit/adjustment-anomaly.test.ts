import { describe, expect, it, vi } from 'vitest';
import { InMemoryCommerceStore } from '../../src/server/services/inventory-ledger.service';
import { AdjustmentService } from '../../src/server/services/adjustment.service';

// `server-only` throws outside a React Server bundle — neutralise it for tests.
vi.mock('server-only', () => ({}));

const ORG = 'org-1';
const LOC = 'loc-1';
const VARIANT = 'variant-1';

const ACTOR = { memberId: 'clerk-1', role: 'WAREHOUSE_CLERK' as const, correlationId: 'corr-adj' };
const MANAGER = { memberId: 'manager-1', role: 'MANAGER' as const, correlationId: 'corr-review' };

function makeStore(onHandQty = 100): InMemoryCommerceStore {
  const store = new InMemoryCommerceStore();
  store.seedOrganizationThresholds(ORG, { suspiciousAdjThresholdCents: 50_000, suspiciousAdjPctBps: 1_000 });
  store.seedVariant({
    id: VARIANT,
    organizationId: ORG,
    sku: 'GPU-TEST-4090',
    variantName: 'ASUS TUF RTX 4090 24GB',
    reorderPoint: 5,
    currency: 'USD',
    unitCostCents: 10_000,
    sellingPriceCents: 12_999,
  });
  store.seedBalance({ organizationId: ORG, locationId: LOC, productVariantId: VARIANT, onHandQty, reservedQty: 0 });
  return store;
}

function adjust(
  store: InMemoryCommerceStore,
  actor: typeof ACTOR | typeof MANAGER = ACTOR,
  quantityDelta: number,
  key = `adj-${Math.random()}`,
) {
  return store.runExclusive((s) =>
    AdjustmentService.createStockAdjustment(s, ORG, actor, key, {
      locationId: LOC,
      productVariantId: VARIANT,
      quantityDelta,
      reasonCode: 'WAREHOUSE_BREAKAGE',
      reasonNotes: 'Cycle count reconciliation explained in detail.',
    }),
  );
}

describe('Stock adjustment anomaly engine (Rule 132)', () => {
  it('applies a small adjustment without flagging it', async () => {
    const store = makeStore(100);
    const record = await adjust(store, ACTOR, -1, 'adj-small');
    expect(record.isSuspicious).toBe(false);
    expect(record.status).toBe('APPLIED');
    expect(store.getBalance(LOC, VARIANT)?.onHandQty).toBe(99);
  });

  it('flags an adjustment whose value crosses the $500 threshold', async () => {
    const store = makeStore(100);
    // 6 units x $100.00 = $600.00 >= $500.00
    const record = await adjust(store, ACTOR, -6, 'adj-value');
    expect(record.isSuspicious).toBe(true);
    expect(record.status).toBe('PENDING_APPROVAL');
    expect(record.suspiciousTriggerReasons).toContain('VALUE_EXCEEDS_THRESHOLD');
    expect(store.outbox_().some((event) => event.eventType === 'SUSPICIOUS_ADJ_ALERT')).toBe(true);
  });

  it('flags shrinkage larger than 10% of current stock', async () => {
    const store = makeStore(20);
    // 3 of 20 = 15% > 10%; value 3 x $100 = $300 < $500
    const record = await adjust(store, ACTOR, -3, 'adj-pct');
    expect(record.suspiciousTriggerReasons).toContain('SHRINKAGE_OVER_10_PCT');
    expect(record.suspiciousTriggerReasons).not.toContain('VALUE_EXCEEDS_THRESHOLD');
  });

  it('flags the third negative adjustment by the same actor within 24h', async () => {
    const store = makeStore(100);
    await adjust(store, ACTOR, -1, 'adj-1');
    await adjust(store, ACTOR, -1, 'adj-2');
    const third = await adjust(store, ACTOR, -1, 'adj-3');
    expect(third.suspiciousTriggerReasons).toContain('HIGH_ACTOR_NEGATIVE_FREQUENCY');
  });

  it('rejects a negative adjustment that would drive available stock below zero', async () => {
    const store = makeStore(2);
    await expect(adjust(store, ACTOR, -5, 'adj-oversell')).rejects.toMatchObject({
      code: 'INSUFFICIENT_AVAILABLE_STOCK',
    });
    expect(store.getBalance(LOC, VARIANT)?.onHandQty).toBe(2);
  });

  it('restores inventory when a manager rejects a flagged adjustment', async () => {
    const store = makeStore(100);
    const flagged = await adjust(store, ACTOR, -6, 'adj-review');
    expect(store.getBalance(LOC, VARIANT)?.onHandQty).toBe(94);

    const reviewed = await store.runExclusive((s) =>
      AdjustmentService.reviewSuspiciousAdjustment(s, ORG, flagged.id, MANAGER, {
        decision: 'REJECT',
        reviewNotes: 'Not approved — recount required.',
      }),
    );
    expect(reviewed.status).toBe('REJECTED');
    expect(store.getBalance(LOC, VARIANT)?.onHandQty).toBe(100);
  });

  it('rejects review attempts from non-management roles', async () => {
    const store = makeStore(100);
    const flagged = await adjust(store, ACTOR, -6, 'adj-forbidden');
    await expect(
      store.runExclusive((s) =>
        AdjustmentService.reviewSuspiciousAdjustment(s, ORG, flagged.id, ACTOR, {
          decision: 'APPROVE',
          reviewNotes: 'Approved by clerk',
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
