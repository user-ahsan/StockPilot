import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db';
import { members } from '@/server/db/schema';
import {
  clearSessionCookies,
  jsonError,
  REFRESH_TOKEN_COOKIE,
  setSessionCookies,
  signAccessToken,
  signRefreshToken,
  toPublicMember,
  verifyRefreshToken,
  type SessionClaims,
} from '@/server/middleware/with-auth';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const correlationId = req.headers.get('x-correlation-id') ?? crypto.randomUUID();

  const token = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!token) return jsonError(401, 'UNAUTHORIZED', 'Missing refresh token.', correlationId);

  const claims = await verifyRefreshToken(token);
  if (!claims) {
    await clearSessionCookies();
    return jsonError(401, 'UNAUTHORIZED', 'Refresh token expired or invalid.', correlationId);
  }

  const [member] = await db
    .select()
    .from(members)
    .where(and(eq(members.id, claims.memberId), eq(members.isActive, true)))
    .limit(1);

  if (!member) {
    await clearSessionCookies();
    return jsonError(401, 'UNAUTHORIZED', 'Account is inactive.', correlationId);
  }

  const fresh: SessionClaims = {
    memberId: member.id,
    organizationId: member.organizationId,
    email: member.email,
    fullName: member.fullName,
    role: member.role,
    assignedLocationId: member.assignedLocationId,
  };

  // Rotate both tokens on every refresh.
  await setSessionCookies(await signAccessToken(fresh), await signRefreshToken(fresh));

  return NextResponse.json({
    data: { member: toPublicMember(member) },
    meta: { correlationId },
  });
}
