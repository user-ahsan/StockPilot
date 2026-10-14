import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { withCommerceStore } from '@/server/services/inventory-ledger.service';
import { AutomationService } from '@/server/services/automation.service';
import { ACCESS_TOKEN_COOKIE, verifyAccessToken } from '@/server/middleware/with-auth';

const DEFAULT_ORGANIZATION_ID = 'a0000000-0000-4000-8000-000000000001';

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Rule 135 — cron secret, or an authenticated OWNER/MANAGER session. */
async function authorise(req: NextRequest): Promise<{ ok: true; organizationId: string } | { ok: false; response: NextResponse }> {
  const secret = process.env.CRON_SHARED_SECRET;
  const provided =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? req.headers.get('x-cron-secret') ?? '';
  if (secret && provided && constantTimeEquals(provided, secret)) {
    return { ok: true, organizationId: req.nextUrl.searchParams.get('organizationId') ?? DEFAULT_ORGANIZATION_ID };
  }

  const store = await cookies();
  const token = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const claims = token ? await verifyAccessToken(token) : null;
  if (claims && (claims.role === 'OWNER' || claims.role === 'MANAGER')) {
    return { ok: true, organizationId: claims.organizationId };
  }

  return {
    ok: false,
    response: NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'A cron secret or an OWNER/MANAGER session is required.', details: null } },
      { status: 401 },
    ),
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authorise(req);
  if (!auth.ok) return auth.response;
  const correlationId = req.headers.get('x-correlation-id') ?? crypto.randomUUID();

  const events = await withCommerceStore((store) => store.listOutboxEvents(auth.organizationId, 100));
  const pendingCount = events.filter((event) => event.status === 'PENDING').length;
  return NextResponse.json({ data: { events, pendingCount }, meta: { correlationId } });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authorise(req);
  if (!auth.ok) return auth.response;
  const correlationId = req.headers.get('x-correlation-id') ?? crypto.randomUUID();

  const result = await withCommerceStore((store) =>
    AutomationService.processPendingOutboxEvents(store, auth.organizationId, 50),
  );
  return NextResponse.json({ data: result, meta: { correlationId } });
}
