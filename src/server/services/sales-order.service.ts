import 'server-only';

/**
 * Sales order reservation, fulfillment, cancellation & oversell protection
 * (Rules 072–074, 081–082, 110, 112, 129, 148).
 */
import { randomUUID } from 'node:crypto';
import { addMoney, calculateLineTotalCents, calculateTaxCents } from '../../lib/money';
import type { MemberRole } from '../middleware/with-auth';
import {
  InventoryLedgerService,
  LedgerInsufficientStockError,
  type CommerceStore,
  type ReferenceMovement,
  type AuditInput,
  type SoHeader,
  type SoItem,
  type SoListFilters,
  type SoStatus,
} from './inventory-ledger.service';

export class SoNotFoundError extends Error {
  readonly code = 'SO_NOT_FOUND';
  readonly status = 404;
  constructor(id: string) {
    super(`Sales order ${id} was not found.`);
    this.name = 'SoNotFoundError';
  }
}

export class SoStateError extends Error {
  readonly code = 'INVALID_SO_STATE_TRANSITION';
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = 'SoStateError';
  }
}

export class SoForbiddenError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 403,
  ) {
    super(message);
    this.name = 'SoForbiddenError';
  }
}

export interface OversellLine {
  productVariantId: string;
  sku: string;
  variantName: string;
  requestedQty: number;
  onHandQty: number;
  reservedQty: number;
  availableQty: number;
}

export class SalesOversellConflictError extends Error {
  readonly code = 'INSUFFICIENT_AVAILABLE_STOCK';
  readonly status = 409;
  constructor(
    message: string,
    readonly details: OversellLine,
  ) {
    super(message);
    this.name = 'SalesOversellConflictError';
  }
}

export interface SoActor {
  memberId: string;
  role: MemberRole;
  correlationId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreateSoInput {
  locationId: string;
  customerName: string;
  customerEmail?: string;
  currency: string;
  taxRateBps: number;
  discountCents: number;
  confirmImmediately: boolean;
  notes?: string;
  items: Array<{ productVariantId: string; quantity: number }>;
}

export interface SoDetail {
  salesOrder: SoHeader;
  items: Array<SoItem & { lineTotalCents: number }>;
  movements: ReferenceMovement[];
  timeline: AuditInput[];
}

export interface SoErrorShape {
  status: number;
  code: string;
  message: string;
  details: unknown;
}

export function toSoError(error: unknown): SoErrorShape | null {
  if (
    error instanceof SoNotFoundError ||
    error instanceof SoStateError ||
    error instanceof SoForbiddenError ||
    error instanceof SalesOversellConflictError
  ) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      details: 'details' in error ? error.details : null,
    };
  }
  if (error instanceof LedgerInsufficientStockError) {
    return { status: error.status, code: error.code, message: error.message, details: error.details };
  }
  return null;
}

export const SalesOrderService = {
  async listSalesOrders(store: CommerceStore, organizationId: string, filters: SoListFilters): Promise<SoHeader[]> {
    return store.listSos(organizationId, filters);
  },

  async getSalesOrderDetail(store: CommerceStore, organizationId: string, soId: string): Promise<SoDetail> {
    const salesOrder = await store.getSo(organizationId, soId);
    if (!salesOrder) throw new SoNotFoundError(soId);
    const items = (await store.listSoItems(organizationId, soId)).map((item) => ({
      ...item,
      lineTotalCents: calculateLineTotalCents(item.quantity, item.unitPriceCents),
    }));
    return {
      salesOrder,
      items,
      movements: await store.listMovementsForReference(organizationId, soId),
      timeline: await store.listAuditsForEntity(organizationId, soId),
    };
  },

  async createAndConfirmSalesOrder(
    store: CommerceStore,
    organizationId: string,
    actor: SoActor,
    input: CreateSoInput,
  ): Promise<SoHeader> {
    // Discount override is a manager-only privilege.
    if (input.discountCents > 0 && actor.role !== 'OWNER' && actor.role !== 'MANAGER') {
      await store.recordAudit({
        organizationId,
        actorMemberId: actor.memberId,
        actorRole: actor.role,
        action: 'UNAUTHORIZED_DISCOUNT_ATTEMPT',
        entityType: 'sales_orders',
        entityId: 'pending',
        correlationId: actor.correlationId,
        afterState: { attemptedDiscountCents: input.discountCents },
      });
      throw new SoForbiddenError('DISCOUNT_REQUIRES_MANAGER', 'Applying an order discount requires the OWNER or MANAGER role.');
    }

    const locked = await store.lockBalances(
      organizationId,
      input.locationId,
      input.items.map((item) => item.productVariantId),
    );
    const byVariant = new Map(locked.map((balance) => [balance.productVariantId, balance]));

    // Rule 112 — authoritative server pricing; Rule 110 — cost snapshot.
    const priced = input.items.map((item) => {
      const balance = byVariant.get(item.productVariantId);
      if (!balance) throw new SoNotFoundError(item.productVariantId);
      return {
        productVariantId: item.productVariantId,
        quantity: item.quantity,
        unitPriceCents: balance.sellingPriceCents,
        unitCostCents: balance.unitCostCents,
        sku: balance.sku,
        variantName: balance.variantName,
        currency: balance.currency,
      };
    });

    const subtotalCents = priced.reduce(
      (sum, line) => addMoney(sum, calculateLineTotalCents(line.quantity, line.unitPriceCents), input.currency, input.currency),
      0,
    );
    const taxCents = calculateTaxCents(subtotalCents, input.taxRateBps);
    const totalCents = subtotalCents + taxCents - input.discountCents;
    if (totalCents < 0) throw new SoStateError('Order total cannot be negative.');

    const soId = randomUUID();
    const status: SoStatus = input.confirmImmediately ? 'CONFIRMED' : 'DRAFT';

    if (input.confirmImmediately) {
      try {
        await InventoryLedgerService.reserveStock(store, {
          organizationId,
          locationId: input.locationId,
          actorMemberId: actor.memberId,
          correlationId: actor.correlationId,
          referenceId: soId,
          currency: input.currency,
          items: priced.map((line) => ({ productVariantId: line.productVariantId, quantity: line.quantity })),
        });
      } catch (error) {
        if (error instanceof LedgerInsufficientStockError) {
          const balance = byVariant.get(error.details.productVariantId);
          throw new SalesOversellConflictError(error.message, {
            productVariantId: error.details.productVariantId,
            sku: error.details.sku,
            variantName: balance?.variantName ?? '',
            requestedQty: error.details.requestedDelta,
            onHandQty: error.details.onHandQty,
            reservedQty: error.details.reservedQty,
            availableQty: error.details.availableQty,
          });
        }
        throw error;
      }
    }

    const now = new Date().toISOString();
    const header: SoHeader = {
      id: soId,
      organizationId,
      soNumber: await store.nextSoNumber(organizationId),
      locationId: input.locationId,
      customerName: input.customerName,
      customerEmail: input.customerEmail ?? null,
      status,
      currency: input.currency,
      subtotalCents,
      taxCents,
      discountCents: input.discountCents,
      totalCents,
      createdByMemberId: actor.memberId,
      fulfilledByMemberId: null,
      fulfilledAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await store.insertSo(header);
    await store.insertSoItems(
      organizationId,
      priced.map((line) => ({
        id: randomUUID(),
        salesOrderId: soId,
        productVariantId: line.productVariantId,
        sku: line.sku,
        variantName: line.variantName,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        unitCostSnapshotCents: line.unitCostCents,
        currency: line.currency,
      })),
    );

    await store.recordAudit({
      organizationId,
      actorMemberId: actor.memberId,
      actorRole: actor.role,
      action: status === 'CONFIRMED' ? 'SO_CONFIRMED_AND_RESERVED' : 'SO_DRAFT_CREATED',
      entityType: 'sales_orders',
      entityId: soId,
      correlationId: actor.correlationId,
      afterState: { soNumber: header.soNumber, status, subtotalCents, taxCents, discountCents: input.discountCents, totalCents },
      reason: input.notes ?? null,
    });

    return header;
  },

  async fulfillSalesOrder(
    store: CommerceStore,
    organizationId: string,
    soId: string,
    actor: SoActor,
    notes?: string,
  ): Promise<SoHeader> {
    const so = await store.lockSo(organizationId, soId);
    if (!so) throw new SoNotFoundError(soId);
    if (so.status !== 'CONFIRMED') {
      throw new SoStateError(`Sales order ${so.soNumber} is ${so.status}; only CONFIRMED orders can be fulfilled.`);
    }

    const items = await store.listSoItems(organizationId, soId);
    await InventoryLedgerService.fulfillReservedStock(store, {
      organizationId,
      locationId: so.locationId,
      actorMemberId: actor.memberId,
      correlationId: actor.correlationId,
      referenceId: soId,
      currency: so.currency,
      items: items.map((item) => ({ productVariantId: item.productVariantId, quantity: item.quantity })),
    });

    const now = new Date().toISOString();
    await store.updateSo(soId, { status: 'FULFILLED', fulfilledByMemberId: actor.memberId, fulfilledAt: now });

    await store.recordAudit({
      organizationId,
      actorMemberId: actor.memberId,
      actorRole: actor.role,
      action: 'SO_FULFILLED',
      entityType: 'sales_orders',
      entityId: soId,
      correlationId: actor.correlationId,
      beforeState: { status: 'CONFIRMED' },
      afterState: { status: 'FULFILLED' },
      reason: notes ?? null,
    });

    return { ...so, status: 'FULFILLED', fulfilledByMemberId: actor.memberId, fulfilledAt: now };
  },

  async cancelSalesOrder(
    store: CommerceStore,
    organizationId: string,
    soId: string,
    actor: SoActor,
    reason: string,
  ): Promise<SoHeader> {
    const so = await store.lockSo(organizationId, soId);
    if (!so) throw new SoNotFoundError(soId);
    if (so.status !== 'DRAFT' && so.status !== 'CONFIRMED') {
      throw new SoStateError(`Sales order ${so.soNumber} is ${so.status}; a FULFILLED order cannot be cancelled.`);
    }

    if (so.status === 'CONFIRMED') {
      const items = await store.listSoItems(organizationId, soId);
      await InventoryLedgerService.releaseReservedStock(store, {
        organizationId,
        locationId: so.locationId,
        actorMemberId: actor.memberId,
        correlationId: actor.correlationId,
        referenceId: soId,
        currency: so.currency,
        items: items.map((item) => ({ productVariantId: item.productVariantId, quantity: item.quantity })),
      });
    }

    await store.updateSo(soId, { status: 'CANCELLED' });
    await store.recordAudit({
      organizationId,
      actorMemberId: actor.memberId,
      actorRole: actor.role,
      action: 'SO_CANCELLED',
      entityType: 'sales_orders',
      entityId: soId,
      correlationId: actor.correlationId,
      reason,
      beforeState: { status: so.status },
      afterState: { status: 'CANCELLED' },
    });

    return { ...so, status: 'CANCELLED' };
  },
};
