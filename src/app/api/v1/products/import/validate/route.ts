import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getPublicEnv } from '@/lib/env';
import { db } from '@/server/db';
import { suppliers } from '@/server/db/schema';
import { jsonError } from '@/server/middleware/with-auth';
import { withRbac } from '@/server/middleware/with-rbac';
import { CsvImportError, validateCsv } from '@/server/services/csv-import.service';

const bodySchema = z
  .object({
    csvText: z.string().min(1),
    fileName: z.string().max(255).optional(),
  })
  .strict();

const FALLBACK_SUPPLIER_CODES = new Set([
  'SUP-TECH',
  'SUP-SVW',
  'SUP-GPU',
  'SUP-MEM',
  'SUP-STOR',
  'SUP-PWR',
]);

export const POST = withRbac(['OWNER', 'MANAGER', 'PROCUREMENT_OFFICER'], async (req: NextRequest, ctx) => {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be valid JSON.', ctx.correlationId);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'VALIDATION_ERROR', 'Invalid CSV validation payload.', ctx.correlationId, parsed.error.issues);
  }

  let knownSupplierCodes: Set<string>;
  try {
    const rows = await db
      .select({ code: suppliers.code })
      .from(suppliers)
      .where(eq(suppliers.organizationId, ctx.organizationId));
    knownSupplierCodes = new Set(rows.map((row) => row.code));
  } catch (error) {
    if (getPublicEnv().NEXT_PUBLIC_APP_ENV === 'prod') throw error;
    console.warn('[products/import/validate] PostgreSQL unavailable — using demo supplier codes.');
    knownSupplierCodes = FALLBACK_SUPPLIER_CODES;
  }

  try {
    const result = validateCsv({ csvText: parsed.data.csvText, knownSupplierCodes });
    return NextResponse.json({ data: result, meta: { correlationId: ctx.correlationId } });
  } catch (error) {
    if (error instanceof CsvImportError) {
      return jsonError(error.status, error.code, error.message, ctx.correlationId);
    }
    throw error;
  }
});
