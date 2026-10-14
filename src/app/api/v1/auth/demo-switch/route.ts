import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getPublicEnv } from '@/lib/env';
import { db } from '@/server/db';
import { members } from '@/server/db/schema';
import {
  jsonError,
  setSessionCookies,
  signAccessToken,
  signRefreshToken,
  toPublicMember,
  type MemberRole,
  type SessionClaims,
} from '@/server/middleware/with-auth';

const DEMO_ROLES = [
  'OWNER',
  'MANAGER',
  'PROCUREMENT_OFFICER',
  'WAREHOUSE_CLERK',
  'SALES_ASSOCIATE',
  'AUDITOR',
] as const;

const demoSwitchSchema = z.object({ role: z.enum(DEMO_ROLES) }).strict();

const DEMO_ORG_ID = 'a0000000-0000-4000-8000-000000000001';

/** Deterministic synthetic ids so the switcher works even before the DB is seeded. */
const DEMO_MEMBER_IDS: Record<MemberRole, string> = {
  OWNER: 'a0000000-0000-4000-8000-000000000201',
  MANAGER: 'a0000000-0000-4000-8000-000000000202',
  PROCUREMENT_OFFICER: 'a0000000-0000-4000-8000-000000000203',
  WAREHOUSE_CLERK: 'a0000000-0000-4000-8000-000000000204',
  SALES_ASSOCIATE: 'a0000000-0000-4000-8000-000000000205',
  AUDITOR: 'a0000000-0000-4000-8000-000000000206',
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const correlationId = req.headers.get('x-correlation-id') ?? crypto.randomUUID();

  // Rule 138 — hard-block outside the demo environment.
  if (getPublicEnv().NEXT_PUBLIC_APP_ENV !== 'demo') {
    return jsonError(
      404,
      'NOT_FOUND',
      'Demo persona switching is disabled outside demo environment',
      correlationId,
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be valid JSON.', correlationId);
  }

  const parsed = demoSwitchSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'VALIDATION_ERROR', 'Invalid demo persona payload.', correlationId, parsed.error.issues);
  }

  const role = parsed.data.role;

  let row: typeof members.$inferSelect | undefined;
  try {
    [row] = await db.select().from(members).where(eq(members.role, role)).limit(1);
  } catch {
    row = undefined; // DB not connected yet — fall back to a signed demo session.
  }

  const claims: SessionClaims = row
    ? {
        memberId: row.id,
        organizationId: row.organizationId,
        email: row.email,
        fullName: row.fullName,
        role: row.role,
        assignedLocationId: row.assignedLocationId,
      }
    : {
        memberId: DEMO_MEMBER_IDS[role],
        organizationId: DEMO_ORG_ID,
        email: `${role.toLowerCase()}@nexushardware.test`,
        fullName: `Demo ${role}`,
        role,
        assignedLocationId: null,
      };

  await setSessionCookies(await signAccessToken(claims), await signRefreshToken(claims));

  const member = row
    ? toPublicMember(row)
    : {
        id: claims.memberId,
        organizationId: claims.organizationId,
        email: claims.email,
        fullName: claims.fullName,
        role: claims.role,
        assignedLocationId: null,
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date(),
      };

  return NextResponse.json({ data: { member }, meta: { correlationId } });
}
