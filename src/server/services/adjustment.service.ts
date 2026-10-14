import 'server-only';

/**
 * Controlled stock adjustments with mandatory actor/reason tracking and the
 * suspicious-anomaly rule engine (Rules 131–133, Doc 5 §5.3 Table 13).
 */
import { randomUUID } from 'node:crypto';
import type { MemberRole } from '../middleware/with-auth';
import {
  InventoryLedgerService,
  type AdjustmentListFilters,
  type AdjustmentReasonCode,
  type AdjustmentRecord,
  type AdjustmentStatusValue,
  type CommerceStore,
} from './inventory-ledger.service';

/** Defaults mirror Document 2 §2.7 (org rows may override them). */
const DEFAULT_SUSPICIOUS_THRESHOLD_CENTS = 50_000;
const DEFAULT_SUSPICIOUS_PCT_BPS = 1_000;

export class AdjustmentNotFoundError extends Error {
  readonly code = 'ADJUSTMENT_NOT_FOUND';
  readonly status = 404;
  constructor(id: string) {
    super(`Stock adjustment ${id} was not found.`);
    this.name = 'AdjustmentNotFoundError';
  }
}

export class AdjustmentStateError extends Error {
  readonly code = 'INVALID_ADJUSTMENT_STATE_TRANSITION';
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = 'AdjustmentStateError';
  }
}

export class AdjustmentForbiddenError extends Error {
  readonly code = 'FORBIDDEN';
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = 'AdjustmentForbiddenError';
  }
}

export interface AdjustmentActor {
  memberId: string;
  role: MemberRole;
  correlationId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreateAdjustmentInput {
  locationId: string;
  productVariantId: string;
  quantityDelta: number;
  reasonCode: AdjustmentReasonCode;
  reasonNotes: string;
}

export interface AdjustmentErrorShape {
  status: number;
  code: string;
  message: string;
  details: unknown;
}

export function toAdjustmentError(error: unknown): AdjustmentErrorShape | null {
  if (
    error instanceof AdjustmentNotFoundError ||
    error instanceof AdjustmentStateError ||
    error instanceof AdjustmentForbiddenError
  ) {
    return { status: error.status, code: error.code, message: error.message, details: null };
  }
  const withStatus = error as { status?: unknown; code?: unknown; details?: unknown; message?: string };
  if (typeof withStatus.status === 'number' && typeof withStatus.code === 'string') {
    return {
      status: withStatus.status,
      code: withStatus.code,
      message: withStatus.message ?? 'Adjustment failed.',
      details: withStatus.details ?? null,
    };
  }
  return null;
}

export const AdjustmentService = {
  async listAdjustments(
    store: CommerceStore,
    organizationId: string,
    filters: AdjustmentListFilters,
  ): Promise<AdjustmentRecord[]> {
    return store.listAdjustments(organizationId, filters);
  },

  async getAdjustment(store: CommerceStore, organizationId: string, adjustmentId: string): Promise<AdjustmentRecord> {
    const adjustment = await store.getAdjustment(organizationId, adjustmentId);
    if (!adjustment) throw new AdjustmentNotFoundError(adjustmentId);
    return adjustment;
  },

  async createStockAdjustment(
    store: CommerceStore,
    organizationId: string,
    actor: AdjustmentActor,
    idempotencyKey: string,
    input: CreateAdjustmentInput,
  ): Promise<AdjustmentRecord> {
    const [balance] = await store.lockBalances(organizationId, input.locationId, [input.productVariantId]);
    if (!balance) throw new AdjustmentNotFoundError(input.productVariantId);

    const thresholds = await store.getOrganizationThresholds(organizationId);
    const valueThresholdCents = thresholds?.suspiciousAdjThresholdCents ?? DEFAULT_SUSPICIOUS_THRESHOLD_CENTS;
    const pctBps = thresholds?.suspiciousAdjPctBps ?? DEFAULT_SUSPICIOUS_PCT_BPS;

    const magnitude = Math.abs(input.quantityDelta);
    const valueImpactCents = magnitude * balance.unitCostCents;
    const triggers: string[] = [];

    if (valueImpactCents >= valueThresholdCents) triggers.push('VALUE_EXCEEDS_THRESHOLD');
    if (balance.onHandQty > 0 && (magnitude * 10_000) / balance.onHandQty > pctBps) {
      triggers.push('SHRINKAGE_OVER_10_PCT');
    }
    if (input.quantityDelta < 0) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const recentNegatives = await store.countRecentNegativeAdjustments(organizationId, actor.memberId, since);
      if (recentNegatives >= 2) triggers.push('HIGH_ACTOR_NEGATIVE_FREQUENCY');
    }

    const isSuspicious = triggers.length > 0;

    // Rejects any negative delta that would push available stock below zero.
    await InventoryLedgerService.applyMovement(store, {
      organizationId,
      locationId: input.locationId,
      movementType: input.quantityDelta > 0 ? 'ADJUSTMENT_POSITIVE' : 'ADJUSTMENT_NEGATIVE',
      referenceType: 'STOCK_ADJUSTMENT',
      referenceId: idempotencyKey,
      actorMemberId: actor.memberId,
      idempotencyKey,
      currency: balance.currency,
      notes: input.reasonNotes,
      items: [
        {
          productVariantId: input.productVariantId,
          quantityDelta: input.quantityDelta,
          unitCostCents: balance.unitCostCents,
        },
      ],
    });

    const adjustmentId = randomUUID();
    const status: AdjustmentStatusValue = isSuspicious ? 'PENDING_APPROVAL' : 'APPLIED';
    const record: AdjustmentRecord = {
      id: adjustmentId,
      organizationId,
      adjustmentNumber: await store.nextAdjustmentNumber(organizationId),
      locationId: input.locationId,
      productVariantId: input.productVariantId,
      quantityDelta: input.quantityDelta,
      unitCostSnapshotCents: balance.unitCostCents,
      totalImpactCents: valueImpactCents,
      currency: balance.currency,
      reasonCode: input.reasonCode,
      reasonNotes: input.reasonNotes,
      status,
      isSuspicious,
      suspiciousTriggerReasons: triggers,
      actorMemberId: actor.memberId,
      reviewedByMemberId: null,
      reviewedAt: null,
      idempotencyKey,
      createdAt: new Date().toISOString(),
      sku: balance.sku,
      variantName: balance.variantName,
      locationCode: balance.locationId,
    };

    await store.insertAdjustment(record);

    await store.recordAudit({
      organizationId,
      actorMemberId: actor.memberId,
      actorRole: actor.role,
      action: 'STOCK_ADJUSTMENT_RECORDED',
      entityType: 'stock_adjustments',
      entityId: adjustmentId,
      correlationId: actor.correlationId,
      reason: input.reasonNotes,
      afterState: {
        adjustmentNumber: record.adjustmentNumber,
        quantityDelta: input.quantityDelta,
        reasonCode: input.reasonCode,
        status,
      },
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
    });

    if (isSuspicious) {
      await store.insertOutbox({
        organizationId,
        eventType: 'SUSPICIOUS_ADJ_ALERT',
        dedupKey: `suspicious_adj:${organizationId}:${adjustmentId}`,
        payload: { adjustmentNumber: record.adjustmentNumber, triggers, valueImpactCents },
      });
      await store.recordAudit({
        organizationId,
        actorMemberId: actor.memberId,
        actorRole: actor.role,
        action: 'SUSPICIOUS_ADJUSTMENT_FLAGGED',
        entityType: 'stock_adjustments',
        entityId: adjustmentId,
        correlationId: actor.correlationId,
        afterState: { triggers },
      });
    }

    return record;
  },

  async reviewSuspiciousAdjustment(
    store: CommerceStore,
    organizationId: string,
    adjustmentId: string,
    actor: AdjustmentActor,
    input: { decision: 'APPROVE' | 'REJECT'; reviewNotes: string },
  ): Promise<AdjustmentRecord> {
    if (actor.role !== 'OWNER' && actor.role !== 'MANAGER') {
      throw new AdjustmentForbiddenError('Only an OWNER or MANAGER may review a flagged adjustment.');
    }

    const adjustment = await store.getAdjustment(organizationId, adjustmentId);
    if (!adjustment) throw new AdjustmentNotFoundError(adjustmentId);
    if (adjustment.status !== 'PENDING_APPROVAL') {
      throw new AdjustmentStateError(
        `Adjustment ${adjustment.adjustmentNumber} is ${adjustment.status}; only PENDING_APPROVAL adjustments can be reviewed.`,
      );
    }

    if (input.decision === 'REJECT') {
      // Compensate the original movement so inventory is restored atomically.
      await InventoryLedgerService.applyMovement(store, {
        organizationId,
        locationId: adjustment.locationId,
        movementType: adjustment.quantityDelta > 0 ? 'ADJUSTMENT_NEGATIVE' : 'ADJUSTMENT_POSITIVE',
        referenceType: 'STOCK_ADJUSTMENT',
        referenceId: adjustmentId,
        actorMemberId: actor.memberId,
        idempotencyKey: `adj-reversal:${adjustmentId}`,
        currency: adjustment.currency,
        notes: `Reversal: ${input.reviewNotes}`,
        items: [
          {
            productVariantId: adjustment.productVariantId,
            quantityDelta: -adjustment.quantityDelta,
            unitCostCents: adjustment.unitCostSnapshotCents,
          },
        ],
      });
    }

    const reviewedAt = new Date().toISOString();
    const status: AdjustmentStatusValue = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await store.updateAdjustment(adjustmentId, { status, reviewedByMemberId: actor.memberId, reviewedAt });

    await store.recordAudit({
      organizationId,
      actorMemberId: actor.memberId,
      actorRole: actor.role,
      action: 'SUSPICIOUS_ADJUSTMENT_REVIEWED',
      entityType: 'stock_adjustments',
      entityId: adjustmentId,
      correlationId: actor.correlationId,
      reason: input.reviewNotes,
      beforeState: { status: adjustment.status },
      afterState: { status },
    });

    return { ...adjustment, status, reviewedByMemberId: actor.memberId, reviewedAt };
  },
};
