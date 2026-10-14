import { and, desc, eq, gte, lt, lte, type SQL } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getPublicEnv } from '@/lib/env';
import { db } from '@/server/db';
import { auditLogs } from '@/server/db/schema';
import { getDemoCommerceStore } from '@/server/services/inventory-ledger.service';
import { jsonError } from '@/server/middleware/with-auth';
import { withRbac } from '@/server/middleware/with-rbac';

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid ISO date');

const auditQuerySchema = z
  .object({
    actorMemberId: z.string().uuid().optional(),
    action: z.string().min(1).optional(),
    entityType: z.string().min(1).optional(),
    entityId: z.string().min(1).optional(),
    fromDate: isoDate.optional(),
    toDate: isoDate.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const GET = withRbac(['OWNER', 'MANAGER', 'AUDITOR'], async (req: NextRequest, ctx) => {
  const parsed = auditQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return jsonError(400, 'VALIDATION_ERROR', 'Invalid audit-log query.', ctx.correlationId, parsed.error.issues);
  }
  const query = parsed.data;

  const conditions: SQL[] = [eq(auditLogs.organizationId, ctx.organizationId)];
  if (query.actorMemberId) conditions.push(eq(auditLogs.actorMemberId, query.actorMemberId));
  if (query.action) conditions.push(eq(auditLogs.action, query.action));
  if (query.entityType) conditions.push(eq(auditLogs.entityType, query.entityType));
  if (query.entityId) conditions.push(eq(auditLogs.entityId, query.entityId));
  if (query.fromDate) conditions.push(gte(auditLogs.createdAt, new Date(query.fromDate)));
  if (query.toDate) conditions.push(lte(auditLogs.createdAt, new Date(query.toDate)));
  if (query.cursor) conditions.push(lt(auditLogs.id, query.cursor));

  let data: Array<Record<string, unknown>>;
  try {
    const rows = await db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.id))
      .limit(query.limit + 1);
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].id : null;
    return NextResponse.json({
      data: page,
      meta: { correlationId: ctx.correlationId, limit: query.limit, hasMore, nextCursor },
    });
  } catch (error) {
    // Dev/demo fallback so the explorer still renders without PostgreSQL.
    if (getPublicEnv().NEXT_PUBLIC_APP_ENV === 'prod') throw error;
    const demoAudits = getDemoCommerceStore().audits_();
    data = demoAudits
      .filter((audit) => audit.organizationId === ctx.organizationId)
      .map((audit, index) => ({ ...audit, id: index + 1, createdAt: new Date(0).toISOString() }));
  }

  return NextResponse.json({
    data,
    meta: { correlationId: ctx.correlationId, limit: query.limit, hasMore: false, nextCursor: null },
  });
});
