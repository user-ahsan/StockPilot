import 'server-only';

/**
 * Transactional outbox processor + daily valuation report (Rules 084–087, 139–143).
 *
 * Every side-effect is dispatched from a claimed outbox row so no external call
 * ever runs inside a database transaction (Rule 084–085).
 */
import { addMoney, calculateGrossMarginBps } from '../../lib/money';
import { PurchaseOrderService, type PoActor } from './purchase-order.service';
import type { CommerceStore, ReportDataset } from './inventory-ledger.service';

const OPEN_PO_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'];
const MAX_ATTEMPTS = 5;

const SYSTEM_ACTOR: PoActor = {
  memberId: 'system-automation',
  role: 'OWNER',
  correlationId: 'automation-outbox',
};

export interface OutboxProcessResult {
  processedCount: number;
  autoDraftedPoIds: string[];
  alertsSent: number;
  skippedCount: number;
  failedCount: number;
  events: Array<{ id: string; eventType: string; outcome: string }>;
}

export interface DailyReport {
  reportDate: string;
  generatedAt: string;
  currency: 'USD';
  salesMetrics: {
    fulfilledOrdersCount: number;
    confirmedReservedOrdersCount: number;
    grossRevenueCents: number;
    cogsCents: number;
    grossProfitCents: number;
    grossMarginBps: number;
    totalUnitsSold: number;
  };
  inventoryMetrics: {
    totalActiveSkus: number;
    totalOnHandUnits: number;
    totalReservedUnits: number;
    totalAvailableUnits: number;
    totalEndingValuationCents: number;
    lowStockSkuCount: number;
    outOfStockSkuCount: number;
  };
  procurementMetrics: {
    openPoCount: number;
    pendingApprovalPoCount: number;
    autoDraftedPoCount: number;
    committedPoValueCents: number;
    unitsReceivedToday: number;
  };
  securityAndShrinkageMetrics: {
    totalAdjustmentsCount: number;
    positiveAdjustmentUnits: number;
    negativeShrinkageUnits: number;
    netShrinkageImpactCents: number;
    suspiciousFlaggedCount: number;
    pendingReviewCount: number;
  };
  locationBreakdown: Array<{
    locationId: string;
    locationCode: string;
    locationName: string;
    skuCount: number;
    onHandUnits: number;
    reservedUnits: number;
    availableUnits: number;
    valuationCents: number;
    lowStockCount: number;
  }>;
  topMovingSkus: Array<{
    productVariantId: string;
    sku: string;
    variantName: string;
    category: string;
    inboundUnits: number;
    outboundUnits: number;
    adjustmentUnits: number;
    onHandQty: number;
    availableQty: number;
    valuationCents: number;
  }>;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export const AutomationService = {
  /** Claim + dispatch every eligible outbox event (Rule 087). */
  async processPendingOutboxEvents(
    store: CommerceStore,
    organizationId: string,
    limit = 50,
  ): Promise<OutboxProcessResult> {
    const claimed = await store.claimPendingOutboxEvents(organizationId, limit);
    const result: OutboxProcessResult = {
      processedCount: 0,
      autoDraftedPoIds: [],
      alertsSent: 0,
      skippedCount: 0,
      failedCount: 0,
      events: [],
    };
    let dataset: ReportDataset = await store.collectReportDataset(organizationId);
    // Raw read (not the validating getPublicEnv) so unit/integration tests run env-free.
    const environment = process.env.NEXT_PUBLIC_APP_ENV ?? 'dev';

    for (const event of claimed) {
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const productVariantId = typeof payload.productVariantId === 'string' ? payload.productVariantId : '';
      const locationId = typeof payload.locationId === 'string' ? payload.locationId : '';
      const sku = typeof payload.sku === 'string' ? payload.sku : '';

      try {
        let outcome = 'PROCESSED';

        if (event.eventType === 'LOW_STOCK_ALERT') {
          await store.recordAudit({
            organizationId,
            actorMemberId: SYSTEM_ACTOR.memberId,
            actorRole: SYSTEM_ACTOR.role,
            action: 'AUTOMATION_LOW_STOCK_ALERT_SENT',
            entityType: 'automation_outbox_events',
            entityId: event.id,
            correlationId: SYSTEM_ACTOR.correlationId,
            reason: `Sandbox low-stock alert (${environment}) for ${sku}`,
            afterState: payload,
          });
          result.alertsSent += 1;
        } else if (event.eventType === 'AUTO_DRAFT_PO') {
          const hasOpenPo = dataset.purchaseOrders.some(
            (po) =>
              OPEN_PO_STATUSES.includes(po.status) &&
              dataset.purchaseOrderItems.some(
                (item) => item.purchaseOrderId === po.id && item.productVariantId === productVariantId,
              ),
          );
          const variant = dataset.variants.find((entry) => entry.id === productVariantId);
          if (hasOpenPo) {
            outcome = 'SKIPPED_OPEN_PO_ALREADY_EXISTS';
            result.skippedCount += 1;
          } else if (!variant) {
            outcome = 'SKIPPED_VARIANT_NOT_FOUND';
            result.skippedCount += 1;
          } else {
            const po = await PurchaseOrderService.createDraftPo(store, organizationId, SYSTEM_ACTOR, {
              supplierId: variant.primarySupplierId,
              locationId,
              currency: 'USD',
              shippingCents: 0,
              notes: `Auto-drafted reorder for ${variant.sku}`,
              isAutoGenerated: true,
              items: [
                {
                  productVariantId,
                  orderedQty: variant.reorderQty,
                  unitCostCents: variant.unitCostCents,
                },
              ],
            });
            result.autoDraftedPoIds.push(po.id);
            await store.recordAudit({
              organizationId,
              actorMemberId: SYSTEM_ACTOR.memberId,
              actorRole: SYSTEM_ACTOR.role,
              action: 'AUTOMATION_AUTO_DRAFT_PO_CREATED',
              entityType: 'purchase_orders',
              entityId: po.id,
              correlationId: SYSTEM_ACTOR.correlationId,
              reason: `Reorder point breached for ${variant.sku}`,
              afterState: { poNumber: po.poNumber, orderedQty: variant.reorderQty },
            });
            dataset = await store.collectReportDataset(organizationId);
          }
        } else if (event.eventType === 'SUPPLIER_PO_EMAIL') {
          const purchaseOrderId = typeof payload.purchaseOrderId === 'string' ? payload.purchaseOrderId : '';
          if (purchaseOrderId) {
            await store.updatePo(purchaseOrderId, { supplierNotifiedAt: new Date().toISOString() });
          }
          await store.recordAudit({
            organizationId,
            actorMemberId: SYSTEM_ACTOR.memberId,
            actorRole: SYSTEM_ACTOR.role,
            action: 'AUTOMATION_SUPPLIER_NOTIFIED',
            entityType: 'purchase_orders',
            entityId: purchaseOrderId || event.id,
            correlationId: SYSTEM_ACTOR.correlationId,
            reason: `Sandbox supplier dispatch (${environment}) for ${String(payload.poNumber ?? '')}`,
            afterState: payload,
          });
          result.alertsSent += 1;
        } else if (event.eventType === 'SUSPICIOUS_ADJ_ALERT') {
          await store.recordAudit({
            organizationId,
            actorMemberId: SYSTEM_ACTOR.memberId,
            actorRole: SYSTEM_ACTOR.role,
            action: 'AUTOMATION_SUSPICIOUS_ADJ_ALERT_SENT',
            entityType: 'stock_adjustments',
            entityId: event.id,
            correlationId: SYSTEM_ACTOR.correlationId,
            reason: 'Sandbox manager anomaly alert',
            afterState: payload,
          });
          result.alertsSent += 1;
        } else {
          outcome = 'SKIPPED_UNKNOWN_EVENT_TYPE';
          result.skippedCount += 1;
        }

        await store.completeOutboxEvent(event.id, outcome);
        result.processedCount += 1;
        result.events.push({ id: event.id, eventType: event.eventType, outcome });
      } catch (error) {
        const attempts = event.attempts + 1;
        const backoffMs = Math.min(60_000, 1_000 * 2 ** attempts);
        await store.failOutboxEvent(event.id, attempts, new Date(Date.now() + backoffMs).toISOString());
        result.failedCount += 1;
        result.events.push({
          id: event.id,
          eventType: event.eventType,
          outcome: attempts >= MAX_ATTEMPTS ? 'FAILED_MAX_ATTEMPTS' : `ERROR: ${(error as Error).message}`,
        });
      }
    }

    return result;
  },

  /** Daily sales, COGS, valuation, procurement and shrinkage snapshot (Rule 143). */
  async generateDailySalesAndValuationReport(
    store: CommerceStore,
    organizationId: string,
    reportDateIso?: string,
    locationId?: string,
  ): Promise<DailyReport> {
    const dataset = await store.collectReportDataset(organizationId);
    const scoped = <T extends { locationId: string }>(rows: T[]): T[] =>
      locationId ? rows.filter((row) => row.locationId === locationId) : rows;

    const balances = scoped(dataset.balances);
    const movements = scoped(dataset.movements);
    const salesOrders = scoped(dataset.salesOrders);
    const salesItems = dataset.salesItems.filter((item) =>
      salesOrders.some((order) => order.id === item.salesOrderId),
    );
    const purchaseOrders = scoped(dataset.purchaseOrders);

    const variantById = new Map(dataset.variants.map((variant) => [variant.id, variant]));
    const balanceByVariant = new Map<string, { onHandQty: number; reservedQty: number }>();
    for (const balance of balances) {
      const current = balanceByVariant.get(balance.productVariantId) ?? { onHandQty: 0, reservedQty: 0 };
      balanceByVariant.set(balance.productVariantId, {
        onHandQty: current.onHandQty + balance.onHandQty,
        reservedQty: current.reservedQty + balance.reservedQty,
      });
    }

    // Sales
    const fulfilledOrders = salesOrders.filter((order) => order.status === 'FULFILLED');
    const fulfilledIds = new Set(fulfilledOrders.map((order) => order.id));
    const fulfilledItems = salesItems.filter((item) => fulfilledIds.has(item.salesOrderId));
    const grossRevenueCents = sum(fulfilledItems.map((item) => item.quantity * item.unitPriceCents));
    const cogsCents = sum(fulfilledItems.map((item) => item.quantity * item.unitCostSnapshotCents));

    // Inventory
    const activeVariants = dataset.variants.filter((variant) => variant.isActive);
    let valuationCents = 0;
    let onHandUnits = 0;
    let reservedUnits = 0;
    let lowStockSkuCount = 0;
    let outOfStockSkuCount = 0;
    for (const [variantId, balance] of balanceByVariant) {
      const variant = variantById.get(variantId);
      if (!variant) continue;
      valuationCents = addMoney(valuationCents, balance.onHandQty * variant.unitCostCents, 'USD', 'USD');
      onHandUnits += balance.onHandQty;
      reservedUnits += balance.reservedQty;
      const available = balance.onHandQty - balance.reservedQty;
      if (available <= 0) outOfStockSkuCount += 1;
      else if (available <= variant.reorderPoint) lowStockSkuCount += 1;
    }

    // Procurement
    const openPos = purchaseOrders.filter((po) => OPEN_PO_STATUSES.includes(po.status));
    const committedPoValueCents = sum(openPos.map((po) => po.totalCents));

    // Adjustments
    const scopedAdjustments = dataset.adjustments.filter((adjustment) =>
      locationId ? adjustment.locationId === locationId : true,
    );
    const negativeAdjustments = scopedAdjustments.filter((adjustment) => adjustment.quantityDelta < 0);

    // Location breakdown
    const locationBreakdown = dataset.locations
      .filter((location) => !locationId || location.id === locationId)
      .map((location) => {
        const scopedBalances = dataset.balances.filter((balance) => balance.locationId === location.id);
        let locationValuation = 0;
        let locationOnHand = 0;
        let locationReserved = 0;
        let locationLowStock = 0;
        for (const balance of scopedBalances) {
          const variant = variantById.get(balance.productVariantId);
          if (!variant) continue;
          locationValuation = addMoney(locationValuation, balance.onHandQty * variant.unitCostCents, 'USD', 'USD');
          locationOnHand += balance.onHandQty;
          locationReserved += balance.reservedQty;
          const available = balance.onHandQty - balance.reservedQty;
          if (available > 0 && available <= variant.reorderPoint) locationLowStock += 1;
        }
        return {
          locationId: location.id,
          locationCode: location.code,
          locationName: location.name,
          skuCount: scopedBalances.length,
          onHandUnits: locationOnHand,
          reservedUnits: locationReserved,
          availableUnits: locationOnHand - locationReserved,
          valuationCents: locationValuation,
          lowStockCount: locationLowStock,
        };
      });

    // Top movers
    const moverMap = new Map<string, { inboundUnits: number; outboundUnits: number; adjustmentUnits: number }>();
    for (const movement of movements) {
      const entry = moverMap.get(movement.productVariantId) ?? { inboundUnits: 0, outboundUnits: 0, adjustmentUnits: 0 };
      if (movement.movementType === 'PO_RECEIPT' || movement.movementType === 'TRANSFER_IN') {
        entry.inboundUnits += movement.quantityDelta;
      } else if (movement.movementType === 'SALE_FULFILLMENT' || movement.movementType === 'TRANSFER_OUT') {
        entry.outboundUnits += Math.abs(movement.quantityDelta);
      } else if (movement.movementType.startsWith('ADJUSTMENT')) {
        entry.adjustmentUnits += Math.abs(movement.quantityDelta);
      }
      moverMap.set(movement.productVariantId, entry);
    }
    const topMovingSkus = [...moverMap.entries()]
      .map(([variantId, entry]) => {
        const variant = variantById.get(variantId);
        const balance = balanceByVariant.get(variantId) ?? { onHandQty: 0, reservedQty: 0 };
        return {
          productVariantId: variantId,
          sku: variant?.sku ?? '',
          variantName: variant?.variantName ?? '',
          category: variant?.category ?? '',
          inboundUnits: entry.inboundUnits,
          outboundUnits: entry.outboundUnits,
          adjustmentUnits: entry.adjustmentUnits,
          onHandQty: balance.onHandQty,
          availableQty: balance.onHandQty - balance.reservedQty,
          valuationCents: balance.onHandQty * (variant?.unitCostCents ?? 0),
          velocity: entry.inboundUnits + entry.outboundUnits + entry.adjustmentUnits,
        };
      })
      .sort((a, b) => b.velocity - a.velocity)
      .slice(0, 10)
      .map((entry) => ({
        productVariantId: entry.productVariantId,
        sku: entry.sku,
        variantName: entry.variantName,
        category: entry.category,
        inboundUnits: entry.inboundUnits,
        outboundUnits: entry.outboundUnits,
        adjustmentUnits: entry.adjustmentUnits,
        onHandQty: entry.onHandQty,
        availableQty: entry.availableQty,
        valuationCents: entry.valuationCents,
      }));

    const generatedAt = new Date().toISOString();
    const reportDate = reportDateIso ?? generatedAt.slice(0, 10);

    const report: DailyReport = {
      reportDate,
      generatedAt,
      currency: 'USD',
      salesMetrics: {
        fulfilledOrdersCount: fulfilledOrders.length,
        confirmedReservedOrdersCount: salesOrders.filter((order) => order.status === 'CONFIRMED').length,
        grossRevenueCents,
        cogsCents,
        grossProfitCents: grossRevenueCents - cogsCents,
        grossMarginBps: calculateGrossMarginBps(cogsCents, grossRevenueCents || 1),
        totalUnitsSold: sum(fulfilledItems.map((item) => item.quantity)),
      },
      inventoryMetrics: {
        totalActiveSkus: activeVariants.length,
        totalOnHandUnits: onHandUnits,
        totalReservedUnits: reservedUnits,
        totalAvailableUnits: onHandUnits - reservedUnits,
        totalEndingValuationCents: valuationCents,
        lowStockSkuCount,
        outOfStockSkuCount,
      },
      procurementMetrics: {
        openPoCount: openPos.length,
        pendingApprovalPoCount: purchaseOrders.filter((po) => po.status === 'SUBMITTED').length,
        autoDraftedPoCount: openPos.filter((po) => po.isAutoGenerated).length,
        committedPoValueCents,
        unitsReceivedToday: sum(
          movements.filter((movement) => movement.movementType === 'PO_RECEIPT').map((movement) => movement.quantityDelta),
        ),
      },
      securityAndShrinkageMetrics: {
        totalAdjustmentsCount: scopedAdjustments.length,
        positiveAdjustmentUnits: sum(
          scopedAdjustments.filter((adjustment) => adjustment.quantityDelta > 0).map((adjustment) => adjustment.quantityDelta),
        ),
        negativeShrinkageUnits: sum(negativeAdjustments.map((adjustment) => Math.abs(adjustment.quantityDelta))),
        netShrinkageImpactCents: sum(negativeAdjustments.map((adjustment) => adjustment.totalImpactCents)),
        suspiciousFlaggedCount: scopedAdjustments.filter((adjustment) => adjustment.isSuspicious).length,
        pendingReviewCount: scopedAdjustments.filter((adjustment) => adjustment.status === 'PENDING_APPROVAL').length,
      },
      locationBreakdown,
      topMovingSkus,
    };

    await store.recordAudit({
      organizationId,
      actorMemberId: SYSTEM_ACTOR.memberId,
      actorRole: SYSTEM_ACTOR.role,
      action: 'DAILY_VALUATION_REPORT_GENERATED',
      entityType: 'reports',
      entityId: reportDate,
      correlationId: SYSTEM_ACTOR.correlationId,
      afterState: {
        reportDate,
        grossRevenueCents,
        grossProfitCents: grossRevenueCents - cogsCents,
        totalEndingValuationCents: valuationCents,
      },
    });

    return report;
  },
};
