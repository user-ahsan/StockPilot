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

/** Rule 135 — cron secret, or an authenticated OWNER/MANAGER/AUDITOR session. */
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
  if (claims && (claims.role === 'OWNER' || claims.role === 'MANAGER' || claims.role === 'AUDITOR')) {
    return { ok: true, organizationId: claims.organizationId };
  }

  return {
    ok: false,
    response: NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'A cron secret or an OWNER/MANAGER/AUDITOR session is required.', details: null } },
      { status: 401 },
    ),
  };
}

async function buildReport(req: NextRequest): Promise<NextResponse> {
  const auth = await authorise(req);
  if (!auth.ok) return auth.response;
  const correlationId = req.headers.get('x-correlation-id') ?? crypto.randomUUID();

  const locationId = req.nextUrl.searchParams.get('locationId') ?? undefined;
  const reportDate = req.nextUrl.searchParams.get('reportDate') ?? undefined;

  const report = await withCommerceStore((store) =>
    AutomationService.generateDailySalesAndValuationReport(store, auth.organizationId, reportDate, locationId),
  );
  return NextResponse.json({ data: report, meta: { correlationId } });
}

export const GET = buildReport;
export const POST = buildReport;
