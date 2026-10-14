import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { members } from '@/server/db/schema';
import {
  jsonError,
  setSessionCookies,
  signAccessToken,
  signRefreshToken,
  toPublicMember,
  verifyPassword,
  type SessionClaims,
} from '@/server/middleware/with-auth';

const loginSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(1),
  })
  .strict();

export async function POST(req: NextRequest): Promise<NextResponse> {
  const correlationId = req.headers.get('x-correlation-id') ?? crypto.randomUUID();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be valid JSON.', correlationId);
  }

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'VALIDATION_ERROR', 'Invalid login payload.', correlationId, parsed.error.issues);
  }

  const [member] = await db
    .select()
    .from(members)
    .where(and(eq(members.email, parsed.data.email), eq(members.isActive, true)))
    .limit(1);

  if (!member) {
    return jsonError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.', correlationId);
  }

  const passwordOk = await verifyPassword(member.passwordHash, parsed.data.password);
  if (!passwordOk) {
    return jsonError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.', correlationId);
  }

  await db.update(members).set({ lastLoginAt: new Date() }).where(eq(members.id, member.id));

  const claims: SessionClaims = {
    memberId: member.id,
    organizationId: member.organizationId,
    email: member.email,
    fullName: member.fullName,
    role: member.role,
    assignedLocationId: member.assignedLocationId,
  };

  await setSessionCookies(await signAccessToken(claims), await signRefreshToken(claims));

  return NextResponse.json({
    data: { member: toPublicMember(member) },
    meta: { correlationId },
  });
}
