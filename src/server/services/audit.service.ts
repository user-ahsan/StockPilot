import 'server-only';

/**
 * Immutable audit trail writer (Rules 133–134, Doc 3 §3.6).
 *
 * Every sensitive mutation records an append-only row inside the same
 * transaction; DB triggers block UPDATE/DELETE outright.
 */
import { db, type Database, type DbTransaction } from '../db';
import { auditLogs } from '../db/schema';
import type { MemberRole } from '../middleware/with-auth';

export interface AuditRecordPayload {
  organizationId: string;
  actorMemberId: string;
  actorRole: MemberRole;
  action: string;
  entityType: string;
  entityId: string;
  correlationId: string;
  reason?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Accepts the pooled client or a transaction so callers can log atomically. */
type AuditExecutor = Database | DbTransaction;

export const AuditService = {
  /** Write a record on the caller's executor (transaction-aware). */
  async record(executor: AuditExecutor, payload: AuditRecordPayload): Promise<void> {
    await executor.insert(auditLogs).values({
      organizationId: payload.organizationId,
      actorMemberId: payload.actorMemberId,
      actorRole: payload.actorRole,
      action: payload.action,
      entityType: payload.entityType,
      entityId: payload.entityId,
      reason: payload.reason ?? null,
      beforeState: payload.beforeState ?? null,
      afterState: payload.afterState ?? null,
      ipAddress: payload.ipAddress ?? null,
      userAgent: payload.userAgent ?? null,
      correlationId: payload.correlationId,
    });
  },

  /** Best-effort log for blocked RBAC violations — never throws. */
  async recordSecurityEvent(payload: AuditRecordPayload): Promise<void> {
    try {
      await AuditService.record(db, payload);
    } catch (error) {
      console.error('[audit] failed to record security event', error);
    }
  },
};
