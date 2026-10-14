import 'server-only';

/**
 * Role-Based Access Control (Rules 125–130, Doc 3 §3.3).
 *
 * `withRbac` wraps `withAuth`; blocked attempts are written to `audit_logs`
 * as `UNAUTHORIZED_ACTION_BLOCKED` and return a structured 403.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { AuditService } from '../services/audit.service';
import {
  jsonError,
  withAuth,
  type AuthenticatedContext,
  type AuthedRouteHandler,
  type MemberRole,
} from './with-auth';

export type Permission =
  | 'VIEW_CATALOG'
  | 'EDIT_PRODUCT_METADATA'
  | 'CHANGE_PRICE'
  | 'BULK_CSV_IMPORT'
  | 'DRAFT_PURCHASE_ORDER'
  | 'APPROVE_PURCHASE_ORDER'
  | 'RECEIVE_PURCHASE_ORDER'
  | 'CREATE_SALES_ORDER'
  | 'FULFILL_SALES_ORDER'
  | 'SUBMIT_STOCK_ADJUSTMENT'
  | 'APPROVE_STOCK_ADJUSTMENT'
  | 'VIEW_AUDIT_LOGS';

/** Permission matrix — mirrors the Doc 3 §3.3 table exactly. */
export const ROLE_PERMISSIONS: Record<Permission, readonly MemberRole[]> = {
  VIEW_CATALOG: ['OWNER', 'MANAGER', 'PROCUREMENT_OFFICER', 'WAREHOUSE_CLERK', 'SALES_ASSOCIATE', 'AUDITOR'],
  EDIT_PRODUCT_METADATA: ['OWNER', 'MANAGER', 'PROCUREMENT_OFFICER'],
  CHANGE_PRICE: ['OWNER', 'MANAGER'],
  BULK_CSV_IMPORT: ['OWNER', 'MANAGER', 'PROCUREMENT_OFFICER'],
  DRAFT_PURCHASE_ORDER: ['OWNER', 'MANAGER', 'PROCUREMENT_OFFICER'],
  APPROVE_PURCHASE_ORDER: ['OWNER', 'MANAGER'],
  RECEIVE_PURCHASE_ORDER: ['OWNER', 'MANAGER', 'WAREHOUSE_CLERK'],
  CREATE_SALES_ORDER: ['OWNER', 'MANAGER', 'SALES_ASSOCIATE'],
  FULFILL_SALES_ORDER: ['OWNER', 'MANAGER', 'WAREHOUSE_CLERK'],
  SUBMIT_STOCK_ADJUSTMENT: ['OWNER', 'MANAGER', 'WAREHOUSE_CLERK'],
  APPROVE_STOCK_ADJUSTMENT: ['OWNER', 'MANAGER'],
  VIEW_AUDIT_LOGS: ['OWNER', 'MANAGER', 'AUDITOR'],
};

export function withRbac(
  allowedRoles: readonly MemberRole[],
  handler: AuthedRouteHandler,
): (req: NextRequest) => Promise<NextResponse> {
  return withAuth(async (req, ctx) => {
    if (!allowedRoles.includes(ctx.role)) {
      await AuditService.recordSecurityEvent({
        organizationId: ctx.organizationId,
        actorMemberId: ctx.memberId,
        actorRole: ctx.role,
        action: 'UNAUTHORIZED_ACTION_BLOCKED',
        entityType: 'api_route',
        entityId: req.nextUrl.pathname,
        correlationId: ctx.correlationId,
        ipAddress: req.headers.get('x-forwarded-for'),
        userAgent: req.headers.get('user-agent'),
      });
      return jsonError(
        403,
        'FORBIDDEN',
        'Insufficient role permissions for this operation',
        ctx.correlationId,
        { requiredRoles: allowedRoles, currentRole: ctx.role },
      );
    }
    return handler(req, ctx);
  });
}

export class LocationAccessError extends Error {
  constructor(public readonly targetLocationId: string) {
    super(`Your account is scoped to a different location than ${targetLocationId}.`);
    this.name = 'LocationAccessError';
  }
}

/**
 * Members scoped to an `assignedLocationId` may not mutate a different
 * location's inventory; OWNER and MANAGER are exempt.
 */
export function assertLocationAccess(ctx: AuthenticatedContext, targetLocationId: string): void {
  if (ctx.role === 'OWNER' || ctx.role === 'MANAGER') return;
  if (ctx.assignedLocationId !== null && ctx.assignedLocationId !== targetLocationId) {
    throw new LocationAccessError(targetLocationId);
  }
}
