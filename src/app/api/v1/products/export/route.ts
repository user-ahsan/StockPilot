import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { getPublicEnv } from '@/lib/env';
import { centsToDecimalString } from '@/lib/money';
import { CSV_REQUIRED_HEADERS, escapeCsvCellForExport } from '@/lib/validators/csv.schema';
import { db } from '@/server/db';
import { productVariants, products, suppliers } from '@/server/db/schema';
import { withAuth } from '@/server/middleware/with-auth';

type ExportRow = Record<(typeof CSV_REQUIRED_HEADERS)[number], string | null>;

const FALLBACK_EXPORT_ROWS: ExportRow[] = [
  {
    sku: 'GPU-NV-4090-24G',
    name: 'ASUS TUF RTX 4090 24GB',
    brand: 'ASUS',
    category: 'GPUs',
    supplier_code: 'SUP-GPU',
    unit_cost: centsToDecimalString(165000),
    selling_price: centsToDecimalString(189999),
    currency: 'USD',
    reorder_point: '5',
    reorder_qty: '25',
    barcode_upc: '0194645115643',
  },
];

export const GET = withAuth(async (req: NextRequest, ctx) => {
  let rows: ExportRow[];
  try {
    const dbRows = await db
      .select({
        sku: productVariants.sku,
        name: products.name,
        brand: products.brand,
        category: products.category,
        supplierCode: suppliers.code,
        unitCostCents: productVariants.unitCostCents,
        sellingPriceCents: productVariants.sellingPriceCents,
        currency: productVariants.currency,
        reorderPoint: productVariants.reorderPoint,
        reorderQty: productVariants.reorderQty,
        barcodeUpc: productVariants.barcodeUpc,
      })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .innerJoin(suppliers, eq(productVariants.primarySupplierId, suppliers.id))
      .where(eq(productVariants.organizationId, ctx.organizationId));

    rows = dbRows.map((row) => ({
      sku: row.sku,
      name: row.name,
      brand: row.brand,
      category: row.category,
      supplier_code: row.supplierCode,
      unit_cost: centsToDecimalString(Number(row.unitCostCents)),
      selling_price: centsToDecimalString(Number(row.sellingPriceCents)),
      currency: row.currency,
      reorder_point: String(row.reorderPoint),
      reorder_qty: String(row.reorderQty),
      barcode_upc: row.barcodeUpc,
    }));
  } catch (error) {
    if (getPublicEnv().NEXT_PUBLIC_APP_ENV === 'prod') throw error;
    console.warn('[products/export] PostgreSQL unavailable — serving demo export rows.');
    rows = FALLBACK_EXPORT_ROWS;
  }

  const header = CSV_REQUIRED_HEADERS.join(',');
  const body = rows
    .map((row) => CSV_REQUIRED_HEADERS.map((column) => escapeCsvCellForExport(row[column])).join(','))
    .join('\r\n');
  const csv = `${header}\r\n${body}\r\n`;

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="stockpilot-catalog-${stamp}.csv"`,
      'X-Correlation-Id': ctx.correlationId,
    },
  });
});
