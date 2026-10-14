/**
 * seed-dev.ts — development baseline seed for "Nexus Hardware & Electronics".
 *
 * Idempotent: if the organization already has members, the seed is a no-op.
 * Run with: `npm run db:seed:dev`
 */
import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../src/server/db/schema';

for (const file of ['.env.local', '.env.development', '.env']) {
  try {
    process.loadEnvFile(file);
    break;
  } catch {
    // try next candidate
  }
}

const ORG_ID = 'a0000000-0000-4000-8000-000000000001';
const LOC_CENTRAL = 'a0000000-0000-4000-8000-000000000101';
const LOC_MAIN = 'a0000000-0000-4000-8000-000000000102';
const LOC_DOWNTOWN = 'a0000000-0000-4000-8000-000000000103';
const M_OWNER = 'a0000000-0000-4000-8000-000000000201';
const M_MANAGER = 'a0000000-0000-4000-8000-000000000202';
const M_PROCUREMENT = 'a0000000-0000-4000-8000-000000000203';
const M_CLERK = 'a0000000-0000-4000-8000-000000000204';
const M_SALES = 'a0000000-0000-4000-8000-000000000205';
const M_AUDITOR = 'a0000000-0000-4000-8000-000000000206';
const SUP = {
  tech: 'a0000000-0000-4000-8000-000000000301',
  svw: 'a0000000-0000-4000-8000-000000000302',
  gpu: 'a0000000-0000-4000-8000-000000000303',
  mem: 'a0000000-0000-4000-8000-000000000304',
  storage: 'a0000000-0000-4000-8000-000000000305',
  power: 'a0000000-0000-4000-8000-000000000306',
} as const;
const PO_OPENING_CENTRAL = 'a0000000-0000-4000-8000-000000000401';
const PO_OPENING_MAIN = 'a0000000-0000-4000-8000-000000000402';
const PO_DRAFT = 'a0000000-0000-4000-8000-000000000501';
const PO_SUBMITTED = 'a0000000-0000-4000-8000-000000000502';
const PO_ORDERED = 'a0000000-0000-4000-8000-000000000503';

type CatalogItem = {
  sku: string;
  barcode: string;
  name: string;
  brand: string;
  category: string;
  cost: number;
  price: number;
  supplierId: string;
  attributes: Record<string, string>;
};

const CATALOG: CatalogItem[] = [
  { sku: 'GPU-NV-4090-24G', barcode: '0194645115643', name: 'ASUS TUF RTX 4090 24GB', brand: 'ASUS', category: 'GPUs', cost: 165000, price: 189999, supplierId: SUP.gpu, attributes: { vram: '24GB', chipset: 'RTX 4090' } },
  { sku: 'GPU-NV-4080S-16G', barcode: '0821422702946', name: 'MSI RTX 4080 Super 16GB', brand: 'MSI', category: 'GPUs', cost: 105000, price: 119999, supplierId: SUP.gpu, attributes: { vram: '16GB', chipset: 'RTX 4080 Super' } },
  { sku: 'CPU-AMD-7950X', barcode: '0730143314406', name: 'AMD Ryzen 9 7950X', brand: 'AMD', category: 'CPUs', cost: 52000, price: 59999, supplierId: SUP.tech, attributes: { cores: '16', socket: 'AM5' } },
  { sku: 'CPU-AMD-7800X3D', barcode: '0730143314482', name: 'AMD Ryzen 7 7800X3D', brand: 'AMD', category: 'CPUs', cost: 34000, price: 39999, supplierId: SUP.tech, attributes: { cores: '8', socket: 'AM5' } },
  { sku: 'RAM-DDR5-32-6000', barcode: '0840000000001', name: 'Corsair Vengeance DDR5 32GB 6000', brand: 'Corsair', category: 'Memory', cost: 9500, price: 11999, supplierId: SUP.mem, attributes: { capacity: '32GB', speed: '6000MHz' } },
  { sku: 'SSD-NVME-990PRO-2TB', barcode: '0887727400001', name: 'Samsung 990 PRO 2TB NVMe', brand: 'Samsung', category: 'Storage', cost: 16000, price: 18999, supplierId: SUP.storage, attributes: { capacity: '2TB', interface: 'PCIe 4.0' } },
  { sku: 'MB-ASUS-X670E', barcode: '0192876087001', name: 'ASUS ROG Crosshair X670E', brand: 'ASUS', category: 'Motherboards', cost: 48000, price: 55999, supplierId: SUP.svw, attributes: { socket: 'AM5', chipset: 'X670E' } },
  { sku: 'PSU-COR-RM1000X', barcode: '0843591000001', name: 'Corsair RM1000x 1000W Gold', brand: 'Corsair', category: 'Power Supplies', cost: 14500, price: 17999, supplierId: SUP.power, attributes: { wattage: '1000W', rating: '80+ Gold' } },
];

type SeededLocation = { id: string; code: string; name: string; address: string; isDefault: boolean };

const LOCATIONS: SeededLocation[] = [
  { id: LOC_CENTRAL, code: 'WH-CENTRAL', name: 'Main Warehouse — Austin', address: '1200 Logistics Pkwy, Austin, TX 78744', isDefault: true },
  { id: LOC_MAIN, code: 'STORE-MAIN', name: 'East Distribution — Raleigh', address: '88 Distribution Dr, Raleigh, NC 27601', isDefault: false },
  { id: LOC_DOWNTOWN, code: 'STORE-DOWNTOWN', name: 'West Hub — Reno', address: '450 Sierra Way, Reno, NV 89501', isDefault: false },
];

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  try {
    const existing = await db
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(eq(schema.members.organizationId, ORG_ID))
      .limit(1);

    if (existing.length > 0) {
      console.log('[seed-dev] Nexus already seeded — skipping.');
      return;
    }

    const passwordHash = await hash('Password123!');

    await db.transaction(async (tx) => {
      await tx
        .insert(schema.organizations)
        .values({ id: ORG_ID, name: 'Nexus Hardware & Electronics', slug: 'nexus-hardware', defaultCurrency: 'USD' })
        .onConflictDoNothing();

      await tx
        .insert(schema.locations)
        .values(LOCATIONS.map((l) => ({ id: l.id, organizationId: ORG_ID, code: l.code, name: l.name, address: l.address, isDefault: l.isDefault })))
        .onConflictDoNothing();

      await tx
        .insert(schema.members)
        .values([
          { id: M_OWNER, organizationId: ORG_ID, email: 'owner@nexushardware.test', fullName: 'Olivia Owner', passwordHash, role: 'OWNER' },
          { id: M_MANAGER, organizationId: ORG_ID, email: 'manager@nexushardware.test', fullName: 'Marcus Manager', passwordHash, role: 'MANAGER', assignedLocationId: LOC_CENTRAL },
          { id: M_PROCUREMENT, organizationId: ORG_ID, email: 'procurement@nexushardware.test', fullName: 'Priya Procurement', passwordHash, role: 'PROCUREMENT_OFFICER' },
          { id: M_CLERK, organizationId: ORG_ID, email: 'clerk@nexushardware.test', fullName: 'Carlos Clerk', passwordHash, role: 'WAREHOUSE_CLERK', assignedLocationId: LOC_CENTRAL },
          { id: M_SALES, organizationId: ORG_ID, email: 'sales@nexushardware.test', fullName: 'Sofia Sales', passwordHash, role: 'SALES_ASSOCIATE', assignedLocationId: LOC_MAIN },
          { id: M_AUDITOR, organizationId: ORG_ID, email: 'auditor@nexushardware.test', fullName: 'Adam Auditor', passwordHash, role: 'AUDITOR' },
        ])
        .onConflictDoNothing();

      await tx
        .insert(schema.suppliers)
        .values([
          { id: SUP.tech, organizationId: ORG_ID, code: 'SUP-TECH', name: 'TechDistro Inc.', contactName: 'Dana Reid', orderEmail: 'orders@techdistro.test', leadTimeDays: 5 },
          { id: SUP.svw, organizationId: ORG_ID, code: 'SUP-SVW', name: 'SiliconValley Wholesale', contactName: 'Sam Vega', orderEmail: 'po@siliconvalley.test', leadTimeDays: 7 },
          { id: SUP.gpu, organizationId: ORG_ID, code: 'SUP-GPU', name: 'GlobalGPU Direct', contactName: 'Grace Lu', orderEmail: 'orders@globalgpu.test', leadTimeDays: 10 },
          { id: SUP.mem, organizationId: ORG_ID, code: 'SUP-MEM', name: 'MemoryWorks Supply', contactName: 'Mo Chen', orderEmail: 'sales@memoryworks.test', leadTimeDays: 4 },
          { id: SUP.storage, organizationId: ORG_ID, code: 'SUP-STOR', name: 'StorageHub Distribution', contactName: 'Stacey Crow', orderEmail: 'orders@storagehub.test', leadTimeDays: 6 },
          { id: SUP.power, organizationId: ORG_ID, code: 'SUP-PWR', name: 'PowerCore Components', contactName: 'Pete Ward', orderEmail: 'po@powercore.test', leadTimeDays: 8 },
        ])
        .onConflictDoNothing();

      const productRows = await tx
        .insert(schema.products)
        .values(CATALOG.map((c) => ({ organizationId: ORG_ID, name: c.name, brand: c.brand, category: c.category })))
        .returning({ id: schema.products.id, name: schema.products.name });
      const productIdByName = new Map(productRows.map((p) => [p.name, p.id]));

      const variantRows = await tx
        .insert(schema.productVariants)
        .values(
          CATALOG.map((c) => ({
            organizationId: ORG_ID,
            productId: productIdByName.get(c.name)!,
            primarySupplierId: c.supplierId,
            sku: c.sku,
            barcodeUpc: c.barcode,
            variantName: c.name,
            attributes: c.attributes,
            currency: 'USD',
            unitCostCents: c.cost,
            sellingPriceCents: c.price,
            reorderPoint: 5,
            reorderQty: 20,
          })),
        )
        .returning({ id: schema.productVariants.id, sku: schema.productVariants.sku });
      const variantIdBySku = new Map(variantRows.map((v) => [v.sku, v.id]));

      // Opening stock: one RECEIVED PO per location + matching PO_RECEIPT ledger.
      for (const loc of [LOC_CENTRAL, LOC_MAIN]) {
        const poId = loc === LOC_CENTRAL ? PO_OPENING_CENTRAL : PO_OPENING_MAIN;
        const items = CATALOG.map((c, i) => ({
          c,
          qty: i % 4 === 0 ? 3 : 20 + ((i * 7) % 60),
        }));
        const subtotal = items.reduce((sum, it) => sum + it.qty * it.c.cost, 0);

        await tx.insert(schema.purchaseOrders).values({
          id: poId, organizationId: ORG_ID, poNumber: loc === LOC_CENTRAL ? 'PO-2026-0001' : 'PO-2026-0002',
          supplierId: SUP.gpu, locationId: loc, status: 'RECEIVED', currency: 'USD',
          subtotalCents: subtotal, taxCents: 0, shippingCents: 0,
          createdByMemberId: M_PROCUREMENT, submittedAt: new Date(), approvedByMemberId: M_MANAGER, approvedAt: new Date(),
          notes: 'Opening stock receipt',
        });

        await tx.insert(schema.purchaseOrderItems).values(
          items.map((it) => ({
            organizationId: ORG_ID, purchaseOrderId: poId, productVariantId: variantIdBySku.get(it.c.sku)!,
            orderedQty: it.qty, receivedQty: it.qty, unitCostCents: it.c.cost, currency: 'USD',
          })),
        );

        await tx.insert(schema.stockMovements).values(
          items.map((it) => ({
            organizationId: ORG_ID, locationId: loc, productVariantId: variantIdBySku.get(it.c.sku)!,
            movementType: 'PO_RECEIPT' as const, quantityDelta: it.qty, balanceBefore: 0, balanceAfter: it.qty,
            unitCostCents: it.c.cost, currency: 'USD', referenceType: 'PURCHASE_ORDER', referenceId: poId,
            actorMemberId: M_CLERK, idempotencyKey: `seed-${it.c.sku}-${loc}-receipt`, notes: 'Opening stock',
          })),
        );

        await tx.insert(schema.inventoryBalances).values(
          items.map((it) => ({
            organizationId: ORG_ID, locationId: loc, productVariantId: variantIdBySku.get(it.c.sku)!,
            onHandQty: it.qty, reservedQty: 0, version: 1,
          })),
        );
      }

      // Sample open POs ready for the concurrent-receiving demo.
      const sample = [
        { id: PO_DRAFT, number: 'PO-2026-0091', status: 'DRAFT' as const, skus: ['GPU-NV-4080S-16G', 'RAM-DDR5-32-6000'] },
        { id: PO_SUBMITTED, number: 'PO-2026-0092', status: 'SUBMITTED' as const, skus: ['CPU-AMD-7950X', 'SSD-NVME-990PRO-2TB'] },
        { id: PO_ORDERED, number: 'PO-2026-0093', status: 'ORDERED' as const, skus: ['GPU-NV-4090-24G', 'PSU-COR-RM1000X'] },
      ];
      for (const po of sample) {
        const items = po.skus.map((sku) => ({
          sku,
          variant: variantIdBySku.get(sku)!,
          cost: CATALOG.find((c) => c.sku === sku)!.cost,
          qty: 10,
        }));
        const subtotal = items.reduce((sum, it) => sum + it.qty * it.cost, 0);
        await tx.insert(schema.purchaseOrders).values({
          id: po.id, organizationId: ORG_ID, poNumber: po.number, supplierId: SUP.gpu, locationId: LOC_CENTRAL,
          status: po.status, currency: 'USD', subtotalCents: subtotal, taxCents: 0, shippingCents: 0,
          createdByMemberId: M_PROCUREMENT,
          submittedAt: po.status === 'DRAFT' ? null : new Date(),
        });
        await tx.insert(schema.purchaseOrderItems).values(
          items.map((it) => ({
            organizationId: ORG_ID, purchaseOrderId: po.id, productVariantId: it.variant,
            orderedQty: it.qty, receivedQty: 0, unitCostCents: it.cost, currency: 'USD',
          })),
        );
      }
    });

    console.log(`[seed-dev] Seeded Nexus Hardware & Electronics (${CATALOG.length} variants, 3 locations, 6 members).`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('[seed-dev] failed:', error);
  process.exitCode = 1;
});
