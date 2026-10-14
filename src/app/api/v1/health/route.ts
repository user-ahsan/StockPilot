import { NextResponse, type NextRequest } from 'next/server';
import { getPublicEnv } from '@/lib/env';

/** Liveness + runtime profile probe (unauthenticated). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const correlationId = req.headers.get('x-correlation-id') ?? crypto.randomUUID();
  return NextResponse.json({
    data: {
      status: 'ok',
      env: getPublicEnv().NEXT_PUBLIC_APP_ENV,
      timestamp: new Date().toISOString(),
    },
    meta: { correlationId },
  });
}
