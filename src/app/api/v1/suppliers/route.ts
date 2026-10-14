import { and, asc, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { getPublicEnv } from '@/lib/env';
import { createSupplierSchema } from '@/lib/validators/product.schema';
import { db } from '@/server/db';
import { suppliers } from '@/server/db/schema';
import { AuditService } from '@/server/services/audit.service';
import { jsonError, withAuth } from '@/server/middleware/with-auth';
import { withIdempotency } from '@/server/middleware/with-idempotency';
import { withRbac } from '@/server/middleware/with-rbac';

interface SupplierRecord {
  id: string;
  code: string;
  name: string;
  contactName: string;
  orderEmail: string;
  phone: string | null;
  currency: string;
  leadTimeDays: number;
  isActive: boolean;
}

const FALLBACK_SUPPLIERS: SupplierRecord[] = [
  { id: 'a0000000-0000-4000-8000-000000000301', code: 'SUP-TECH', name: 'TechDistro Inc.', contactName: 'Dana Reid', orderEmail: 'orders@techdistro.test', phone: null, currency: 'USD', leadTimeDays: 5, isActive: true },
  { id: 'a0000000-0000-4000-8000-000000000302', code: 'SUP-SVW', name: 'SiliconValley Wholesale', contactName: 'Sam Vega', orderEmail: 'po@siliconvalley.test', phone: null, currency: 'USD', leadTimeDays: 7, isActive: true },
  { id: 'a0000000-0000-4000-8000-000000000303', code: 'SUP-GPU', name: 'GlobalGPU Direct', contactName: 'Grace Lu', orderEmail: 'orders@globalgpu.test', phone: null, currency: 'USD', leadTimeDays: 10, isActive: true },
  { id: 'a0000000-0000-4000-8000-000000000304', code: 'SUP-MEM', name: 'MemoryWorks Supply', contactName: 'Mo Chen', orderEmail: 'sales@memoryworks.test', phone: null, currency: 'USD', leadTimeDays: 4, isActive: true },
  { id: 'a0000000-0000-4000-8000-000000000305', code: 'SUP-STOR', name: 'StorageHub Distribution', contactName: 'Stacey Crow', orderEmail: 'orders@storagehub.test', phone: null, currency: 'USD', leadTimeDays: 6, isActive: true },
  { id: 'a0000000-0000-4000-8000-000000000306', code: 'SUP-PWR', name: 'PowerCore Components', contactName: 'Pete Ward', orderEmail: 'po@powercore.test', phone: null, currency: 'USD', leadTimeDays: 8, isActive: true },
];

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  try {
    const rows = await db
      .select({
        id: suppliers.id,
        code: suppliers.code,
        name: suppliers.name,
        contactName: suppliers.contactName,
        orderEmail: suppliers.orderEmail,
        phone: suppliers.phone,
        currency: suppliers.currency,
        leadTimeDays: suppliers.leadTimeDays,
        isActive: suppliers.isActive,
      })
      .from(suppliers)
      .where(and(eq(suppliers.organizationId, ctx.organizationId), eq(suppliers.isActive, true)))
      .orderBy(asc(suppliers.name));
    return NextResponse.json({ data: rows, meta: { correlationId: ctx.correlationId } });
  } catch (error) {
    if (getPublicEnv().NEXT_PUBLIC_APP_ENV === 'prod') throw error;
    console.warn('[suppliers] PostgreSQL unavailable — serving demo fallback data.');
    return NextResponse.json({ data: FALLBACK_SUPPLIERS, meta: { correlationId: ctx.correlationId } });
  }
});

export const POST = withRbac(
  ['OWNER', 'MANAGER', 'PROCUREMENT_OFFICER'],
  withIdempotency(async (req: NextRequest, ctx) => {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonError(400, 'INVALID_JSON', 'Request body must be valid JSON.', ctx.correlationId);
    }

    const parsed = createSupplierSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, 'VALIDATION_ERROR', 'Invalid supplier payload.', ctx.correlationId, parsed.error.issues);
    }

    const [created] = await db
      .insert(suppliers)
      .values({ organizationId: ctx.organizationId, ...parsed.data })
      .returning();

    await AuditService.record(db, {
      organizationId: ctx.organizationId,
      actorMemberId: ctx.memberId,
      actorRole: ctx.role,
      action: 'SUPPLIER_CREATED',
      entityType: 'suppliers',
      entityId: created.id,
      afterState: { code: created.code, name: created.name },
      correlationId: ctx.correlationId,
      ipAddress: req.headers.get('x-forwarded-for'),
      userAgent: req.headers.get('user-agent'),
    });

    return NextResponse.json({ data: created, meta: { correlationId: ctx.correlationId } }, { status: 201 });
  }),
);
