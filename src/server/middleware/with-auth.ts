import 'server-only';

/**
 * Authentication core (Rules 121–124, Doc 3 §3.1).
 *
 * Argon2id password hashing + HS256 JWT sessions stored exclusively in
 * HttpOnly cookies. Every `src/server/**` module starts with `server-only`.
 */
import { hash, verify } from '@node-rs/argon2';
import { and, eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getServerEnv } from '@/lib/env';
import { db } from '../db';
import { memberRoleEnum, members, type Member } from '../db/schema';

export type MemberRole = (typeof memberRoleEnum.enumValues)[number];

export type PublicMember = Omit<Member, 'passwordHash'>;

/** Strip the Argon2id hash before a member ever leaves the server. */
export function toPublicMember(member: Member): PublicMember {
  return {
    id: member.id,
    organizationId: member.organizationId,
    email: member.email,
    fullName: member.fullName,
    role: member.role,
    assignedLocationId: member.assignedLocationId,
    isActive: member.isActive,
    lastLoginAt: member.lastLoginAt,
    createdAt: member.createdAt,
  };
}

export const ACCESS_TOKEN_COOKIE = 'sp_access_token';
export const REFRESH_TOKEN_COOKIE = 'sp_refresh_token';

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
const ARGON2_OPTIONS = { memoryCost: 65536, timeCost: 3, parallelism: 4 } as const;

export interface SessionClaims {
  memberId: string;
  organizationId: string;
  email: string;
  fullName: string;
  role: MemberRole;
  assignedLocationId: string | null;
}

export interface AuthenticatedContext extends SessionClaims {
  correlationId: string;
}

export type AuthedRouteHandler = (
  req: NextRequest,
  ctx: AuthenticatedContext,
) => Promise<NextResponse>;

const encoder = new TextEncoder();
const signingKey = () => encoder.encode(getServerEnv().SESSION_JWT_SECRET);

// ── Passwords (Rule 123) ──────────────────────────────────────────────
export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

// ── JWT (Rules 124) ───────────────────────────────────────────────────
async function signToken(
  claims: SessionClaims,
  expiresIn: string,
  tokenType: 'access' | 'refresh',
): Promise<string> {
  return new SignJWT({
    orgId: claims.organizationId,
    email: claims.email,
    fullName: claims.fullName,
    role: claims.role,
    locationId: claims.assignedLocationId,
    typ: tokenType,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.memberId)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(signingKey());
}

export const signAccessToken = (claims: SessionClaims) => signToken(claims, '15m', 'access');
export const signRefreshToken = (claims: SessionClaims) => signToken(claims, '7d', 'refresh');

async function verifyToken(token: string, expectedType: 'access' | 'refresh'): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'] });
    const memberId = typeof payload.sub === 'string' ? payload.sub : null;
    const organizationId = typeof payload.orgId === 'string' ? payload.orgId : null;
    const email = typeof payload.email === 'string' ? payload.email : null;
    const fullName = typeof payload.fullName === 'string' ? payload.fullName : null;
    const role = payload.role;
    const locationId = payload.locationId;
    if (
      payload.typ !== expectedType ||
      !memberId ||
      !organizationId ||
      !email ||
      !fullName ||
      typeof role !== 'string' ||
      !(memberRoleEnum.enumValues as readonly string[]).includes(role)
    ) {
      return null;
    }
    return {
      memberId,
      organizationId,
      email,
      fullName,
      role: role as MemberRole,
      assignedLocationId: typeof locationId === 'string' ? locationId : null,
    };
  } catch {
    return null;
  }
}

export const verifyAccessToken = (token: string) => verifyToken(token, 'access');
export const verifyRefreshToken = (token: string) => verifyToken(token, 'refresh');

// ── Cookies (Doc 3 §3.1) ──────────────────────────────────────────────
export async function setSessionCookies(accessToken: string, refreshToken: string): Promise<void> {
  const store = await cookies();
  const secure = process.env.NODE_ENV === 'production';
  store.set(ACCESS_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: ACCESS_TTL_SECONDS,
  });
  store.set(REFRESH_TOKEN_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/api/v1/auth/refresh',
    maxAge: REFRESH_TTL_SECONDS,
  });
}

export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_TOKEN_COOKIE);
  store.delete(REFRESH_TOKEN_COOKIE);
}

// ── Response helper ───────────────────────────────────────────────────
export function jsonError(
  status: number,
  code: string,
  message: string,
  correlationId: string,
  details: unknown = null,
): NextResponse {
  return NextResponse.json({ error: { code, message, details, correlationId } }, { status });
}

// ── withAuth (Rule 125) ───────────────────────────────────────────────
async function loadLiveMember(claims: SessionClaims): Promise<SessionClaims | null> {
  try {
    const [row] = await db
      .select()
      .from(members)
      .where(and(eq(members.id, claims.memberId), eq(members.organizationId, claims.organizationId)))
      .limit(1);
    if (!row || !row.isActive) return null;
    return {
      memberId: row.id,
      organizationId: row.organizationId,
      email: row.email,
      fullName: row.fullName,
      role: row.role,
      assignedLocationId: row.assignedLocationId,
    };
  } catch (error) {
    // Doc 3 §3.1: demo/dev offline fallback to verified claims — never in prod.
    if (process.env.NEXT_PUBLIC_APP_ENV !== 'prod') return claims;
    throw error;
  }
}

export function withAuth(handler: AuthedRouteHandler): (req: NextRequest) => Promise<NextResponse> {
  return async (req: NextRequest): Promise<NextResponse> => {
    const correlationId = req.headers.get('x-correlation-id') ?? crypto.randomUUID();
    const store = await cookies();
    const token = store.get(ACCESS_TOKEN_COOKIE)?.value;
    if (!token) return jsonError(401, 'UNAUTHORIZED', 'Authentication required.', correlationId);

    const claims = await verifyAccessToken(token);
    if (!claims) return jsonError(401, 'UNAUTHORIZED', 'Session expired or invalid.', correlationId);

    const live = await loadLiveMember(claims);
    if (!live) return jsonError(401, 'UNAUTHORIZED', 'Account is inactive.', correlationId);

    return handler(req, { ...live, correlationId });
  };
}
