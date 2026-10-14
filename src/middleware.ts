/**
 * Global Next.js Edge middleware (Rule 146, Doc 3 §3.1).
 *
 * Edge-safe: only `jose` (Web Crypto) is used here — never `pg`/argon2.
 * Generates/propagates X-Correlation-Id and gates the dashboard routes.
 */
import { jwtVerify } from 'jose';
import { NextResponse, type NextRequest } from 'next/server';

const ACCESS_COOKIE = 'sp_access_token';

const PUBLIC_PATHS = ['/login', '/invite', '/api/v1/health', '/api/v1/auth'];

const PROTECTED_PREFIXES = [
  '/overview',
  '/catalog',
  '/purchase-orders',
  '/sales-orders',
  '/adjustments',
  '/suppliers',
  '/reports',
  '/audit-logs',
];

const matches = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

// Rule 136 exception: middleware runs on the Edge runtime, so it reads the
// secret directly rather than importing the `pg`-adjacent env module.
async function hasValidAccessToken(token: string): Promise<boolean> {
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const correlationId = req.headers.get('x-correlation-id') ?? crypto.randomUUID();
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((p) => matches(pathname, p));
  const isPublic = PUBLIC_PATHS.some((p) => matches(pathname, p));

  if (isProtected && !isPublic) {
    const token = req.cookies.get(ACCESS_COOKIE)?.value;
    const valid = token ? await hasValidAccessToken(token) : false;
    if (!valid) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('next', pathname);
      const redirect = NextResponse.redirect(url);
      redirect.headers.set('x-correlation-id', correlationId);
      return redirect;
    }
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-correlation-id', correlationId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('x-correlation-id', correlationId);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
