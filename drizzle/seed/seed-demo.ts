/**
 * seed-demo.ts — rich hardware-store demo dataset for "Nexus Hardware & Electronics".
 *
 * Idempotent: re-running is a no-op once the organization has members.
 * Run with: `npm run db:seed:demo`
 */
import { hash } from '@node-rs/argon2';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../src/server/db/schema';

for (const file of ['.env.local', '.env.demo', '.env']) {
  try {
    process.loadEnvFile(file);
    break;
  } catch {
    // try next candidate
  }
}

const ORG_ID = 'a0000000-0000-4000-8000-000000000001';
const LOC_CENTRAL = 'a0000000-0000-4000-8000-000000000101';
const LOC_EAST = 'a0000000-0000-4000-8000-000000000102';
const LOC_WEST = 'a0000000-0000-4000-8000-000000000103';
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
const PO_OPENING_EAST = 'a0000000-0000-4000-8000-000000000402';
const SO_CONFIRMED = 'a0000000-0000-4000-8000-000000000601';

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
  { sku: 'GPU-NV-4070TI-12G', barcode: '0889526514875', name: 'Gigabyte RTX 4070 Ti 12GB', brand: 'Gigabyte', category: 'GPUs', cost: 78000, price: 89999, supplierId: SUP.gpu, attributes: { vram: '12GB', chipset: 'RTX 4070 Ti' } },
  { sku: 'GPU-AMD-7900XTX-24G', barcode: '0840369100001', name: 'Sapphire RX 7900 XTX 24GB', brand: 'Sapphire', category: 'GPUs', cost: 92000, price: 104999, supplierId: SUP.gpu, attributes: { vram: '24GB', chipset: 'RX 7900 XTX' } },
  { sku: 'GPU-AMD-7800XT-16G', barcode: '0840369100002', name: 'PowerColor RX 7800 XT 16GB', brand: 'PowerColor', category: 'GPUs', cost: 48000, price: 54999, supplierId: SUP.gpu, attributes: { vram: '16GB', chipset: 'RX 7800 XT' } },
  { sku: 'CPU-AMD-7950X', barcode: '0730143314406', name: 'AMD Ryzen 9 7950X', brand: 'AMD', category: 'CPUs', cost: 52000, price: 59999, supplierId: SUP.tech, attributes: { cores: '16', socket: 'AM5' } },
  { sku: 'CPU-AMD-7800X3D', barcode: '0730143314482', name: 'AMD Ryzen 7 7800X3D', brand: 'AMD', category: 'CPUs', cost: 34000, price: 39999, supplierId: SUP.tech, attributes: { cores: '8', socket: 'AM5' } },
  { sku: 'CPU-INT-14900K', barcode: '0735858516326', name: 'Intel Core i9-14900K', brand: 'Intel', category: 'CPUs', cost: 54000, price: 61999, supplierId: SUP.tech, attributes: { cores: '24', socket: 'LGA1700' } },
  { sku: 'CPU-INT-14600K', barcode: '0735858516340', name: 'Intel Core i5-14600K', brand: 'Intel', category: 'CPUs', cost: 26000, price: 30999, supplierId: SUP.tech, attributes: { cores: '14', socket: 'LGA1700' } },
  { sku: 'RAM-DDR5-32-6000', barcode: '0840000000001', name: 'Corsair Vengeance DDR5 32GB 6000', brand: 'Corsair', category: 'Memory', cost: 9500, price: 11999, supplierId: SUP.mem, attributes: { capacity: '32GB', speed: '6000MHz' } },
  { sku: 'RAM-DDR5-64-5600', barcode: '0848440900001', name: 'G.Skill Trident Z5 DDR5 64GB 5600', brand: 'G.Skill', category: 'Memory', cost: 19000, price: 22999, supplierId: SUP.mem, attributes: { capacity: '64GB', speed: '5600MHz' } },
  { sku: 'RAM-DDR5-32-6400', barcode: '0740617320001', name: 'Kingston Fury DDR5 32GB 6400', brand: 'Kingston', category: 'Memory', cost: 10500, price: 12999, supplierId: SUP.mem, attributes: { capacity: '32GB', speed: '6400MHz' } },
  { sku: 'RAM-DDR4-32-3600', barcode: '0649528800001', name: 'Crucial Ballistix DDR4 32GB 3600', brand: 'Crucial', category: 'Memory', cost: 7200, price: 8999, supplierId: SUP.mem, attributes: { capacity: '32GB', speed: '3600MHz' } },
  { sku: 'SSD-NVME-990PRO-2TB', barcode: '0887727400001', name: 'Samsung 990 PRO 2TB NVMe', brand: 'Samsung', category: 'Storage', cost: 16000, price: 18999, supplierId: SUP.storage, attributes: { capacity: '2TB', interface: 'PCIe 4.0' } },
  { sku: 'SSD-NVME-980-1TB', barcode: '0887727400002', name: 'Samsung 980 1TB NVMe', brand: 'Samsung', category: 'Storage', cost: 7500, price: 8999, supplierId: SUP.storage, attributes: { capacity: '1TB', interface: 'PCIe 3.0' } },
  { sku: 'SSD-NVME-SN850X-2TB', barcode: '0718037880001', name: 'WD Black SN850X 2TB NVMe', brand: 'Western Digital', category: 'Storage', cost: 14500, price: 16999, supplierId: SUP.storage, attributes: { capacity: '2TB', interface: 'PCIe 4.0' } },
  { sku: 'SSD-NVME-KC3000-1TB', barcode: '0740617320002', name: 'Kingston KC3000 1TB NVMe', brand: 'Kingston', category: 'Storage', cost: 8500, price: 9999, supplierId: SUP.storage, attributes: { capacity: '1TB', interface: 'PCIe 4.0' } },
  { sku: 'MB-ASUS-X670E', barcode: '0192876087001', name: 'ASUS ROG Crosshair X670E', brand: 'ASUS', category: 'Motherboards', cost: 48000, price: 55999, supplierId: SUP.svw, attributes: { socket: 'AM5', chipset: 'X670E' } },
  { sku: 'MB-MSI-B650', barcode: '0824142200001', name: 'MSI MAG B650 Tomahawk', brand: 'MSI', category: 'Motherboards', cost: 18000, price: 21999, supplierId: SUP.svw, attributes: { socket: 'AM5', chipset: 'B650' } },
  { sku: 'MB-GIG-Z790', barcode: '0889526510001', name: 'Gigabyte Z790 Aorus Elite', brand: 'Gigabyte', category: 'Motherboards', cost: 24000, price: 28999, supplierId: SUP.svw, attributes: { socket: 'LGA1700', chipset: 'Z790' } },
  { sku: 'MB-ASROCK-B760', barcode: '0471758010001', name: 'ASRock B760M Pro RS', brand: 'ASRock', category: 'Motherboards', cost: 11000, price: 13999, supplierId: SUP.svw, attributes: { socket: 'LGA1700', chipset: 'B760' } },
  { sku: 'PSU-COR-RM1000X', barcode: '0843591000001', name: 'Corsair RM1000x 1000W Gold', brand: 'Corsair', category: 'Power Supplies', cost: 14500, price: 17999, supplierId: SUP.power, attributes: { wattage: '1000W', rating: '80+ Gold' } },
  { sku: 'PSU-SEA-FOCUS-850', barcode: '0846387000001', name: 'Seasonic Focus GX-850 Gold', brand: 'Seasonic', category: 'Power Supplies', cost: 11000, price: 13999, supplierId: SUP.power, attributes: { wattage: '850W', rating: '80+ Gold' } },
  { sku: 'PSU-EVGA-750', barcode: '0843399000001', name: 'EVGA SuperNOVA 750 G6', brand: 'EVGA', category: 'Power Supplies', cost: 9000, price: 10999, supplierId: SUP.power, attributes: { wattage: '750W', rating: '80+ Gold' } },
];

type SeededLocation = { id: string; code: string; name: string; address: string; isDefault: boolean };

const LOCATIONS: SeededLocation[] = [
  { id: LOC_CENTRAL, code: 'WH-CENTRAL', name: 'Main Warehouse — Austin', address: '1200 Logistics Pkwy, Austin, TX 78744', isDefault: true },
  { id: LOC_EAST, code: 'STORE-MAIN', name: 'East Distribution — Raleigh', address: '88 Distribution Dr, Raleigh, NC 27601', isDefault: false },
  { id: LOC_WEST, code: 'STORE-DOWNTOWN', name: 'West Hub — Reno', address: '450 Sierra Way, Reno, NV 89501', isDefault: false },
];

const SUPPLIER_ROWS = [
  { id: SUP.tech, code: 'SUP-TECH', name: 'TechDistro Inc.', contactName: 'Dana Reid', orderEmail: 'orders@techdistro.test', leadTimeDays: 5 },
  { id: SUP.svw, code: 'SUP-SVW', name: 'SiliconValley Wholesale', contactName: 'Sam Vega', orderEmail: 'po@siliconvalley.test', leadTimeDays: 7 },
  { id: SUP.gpu, code: 'SUP-GPU', name: 'GlobalGPU Direct', contactName: 'Grace Lu', orderEmail: 'orders@globalgpu.test', leadTimeDays: 10 },
  { id: SUP.mem, code: 'SUP-MEM', name: 'MemoryWorks Supply', contactName: 'Mo Chen', orderEmail: 'sales@memoryworks.test', leadTimeDays: 4 },
  { id: SUP.storage, code: 'SUP-STOR', name: 'StorageHub Distribution', contactName: 'Stacey Crow', orderEmail: 'orders@storagehub.test', leadTimeDays: 6 },
  { id: SUP.power, code: 'SUP-PWR', name: 'PowerCore Components', contactName: 'Pete Ward', orderEmail: 'po@powercore.test', leadTimeDays: 8 },
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
      console.log('[seed-demo] Nexus already seeded — skipping.');
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
          { id: M_SALES, organizationId: ORG_ID, email: 'sales@nexushardware.test', fullName: 'Sofia Sales', passwordHash, role: 'SALES_ASSOCIATE', assignedLocationId: LOC_EAST },
          { id: M_AUDITOR, organizationId: ORG_ID, email: 'auditor@nexushardware.test', fullName: 'Adam Auditor', passwordHash, role: 'AUDITOR' },
        ])
        .onConflictDoNothing();

      await tx
        .insert(schema.suppliers)
        .values(SUPPLIER_ROWS.map((s) => ({ ...s, organizationId: ORG_ID })))
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
            reorderQty: 25,
          })),
        )
        .returning({ id: schema.productVariants.id, sku: schema.productVariants.sku });
      const variantIdBySku = new Map(variantRows.map((v) => [v.sku, v.id]));

      // Opening stock at two locations, with a matching PO_RECEIPT per SKU.
      for (const [loc, poId, poNumber] of [
        [LOC_CENTRAL, PO_OPENING_CENTRAL, 'PO-2026-0001'],
        [LOC_EAST, PO_OPENING_EAST, 'PO-2026-0002'],
      ] as const) {
        const items = CATALOG.map((c, i) => ({ c, qty: i % 5 === 0 ? 2 : 25 + ((i * 11) % 70) }));
        const subtotal = items.reduce((sum, it) => sum + it.qty * it.c.cost, 0);

        await tx.insert(schema.purchaseOrders).values({
          id: poId, organizationId: ORG_ID, poNumber, supplierId: SUP.gpu, locationId: loc,
          status: 'RECEIVED', currency: 'USD', subtotalCents: subtotal, taxCents: 0, shippingCents: 0,
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

      // Open POs at every lifecycle stage for the receiving demo.
      const samplePos = [
        { id: 'a0000000-0000-4000-8000-000000000501', number: 'PO-2026-0091', status: 'DRAFT' as const, skus: ['GPU-NV-4080S-16G', 'RAM-DDR5-32-6000'] },
        { id: 'a0000000-0000-4000-8000-000000000502', number: 'PO-2026-0092', status: 'SUBMITTED' as const, skus: ['CPU-AMD-7950X', 'SSD-NVME-990PRO-2TB'] },
        { id: 'a0000000-0000-4000-8000-000000000503', number: 'PO-2026-0093', status: 'APPROVED' as const, skus: ['MB-ASUS-X670E', 'PSU-COR-RM1000X'] },
        { id: 'a0000000-0000-4000-8000-000000000504', number: 'PO-2026-0094', status: 'ORDERED' as const, skus: ['GPU-NV-4090-24G', 'CPU-INT-14900K'] },
      ];
      for (const po of samplePos) {
        const items = po.skus.map((sku) => ({ sku, variant: variantIdBySku.get(sku)!, cost: CATALOG.find((c) => c.sku === sku)!.cost, qty: 10 }));
        const subtotal = items.reduce((sum, it) => sum + it.qty * it.cost, 0);
        await tx.insert(schema.purchaseOrders).values({
          id: po.id, organizationId: ORG_ID, poNumber: po.number, supplierId: SUP.gpu, locationId: LOC_CENTRAL,
          status: po.status, currency: 'USD', subtotalCents: subtotal, taxCents: 0, shippingCents: 0,
          createdByMemberId: M_PROCUREMENT,
          submittedAt: po.status === 'DRAFT' ? null : new Date(),
          approvedByMemberId: po.status === 'APPROVED' || po.status === 'ORDERED' ? M_MANAGER : null,
          approvedAt: po.status === 'APPROVED' || po.status === 'ORDERED' ? new Date() : null,
        });
        await tx.insert(schema.purchaseOrderItems).values(
          items.map((it) => ({
            organizationId: ORG_ID, purchaseOrderId: po.id, productVariantId: it.variant,
            orderedQty: it.qty, receivedQty: 0, unitCostCents: it.cost, currency: 'USD',
          })),
        );
      }

      // A CONFIRMED sales order that has reserved stock (audit-logged, no ledger delta).
      const soItems = [
        { sku: 'GPU-NV-4080S-16G', qty: 2 },
        { sku: 'RAM-DDR5-32-6000', qty: 1 },
      ].map((it) => ({ ...it, variant: variantIdBySku.get(it.sku)!, price: CATALOG.find((c) => c.sku === it.sku)!.price, cost: CATALOG.find((c) => c.sku === it.sku)!.cost }));
      const soSubtotal = soItems.reduce((sum, it) => sum + it.qty * it.price, 0);

      await tx.insert(schema.salesOrders).values({
        id: SO_CONFIRMED, organizationId: ORG_ID, soNumber: 'SO-2026-1088', locationId: LOC_CENTRAL,
        customerName: 'Acme Studios LLC', customerEmail: 'buyer@acmestudios.test', status: 'CONFIRMED',
        currency: 'USD', subtotalCents: soSubtotal, taxCents: 0, discountCents: 0, createdByMemberId: M_SALES,
      });
      await tx.insert(schema.salesOrderItems).values(
        soItems.map((it) => ({
          organizationId: ORG_ID, salesOrderId: SO_CONFIRMED, productVariantId: it.variant,
          quantity: it.qty, unitPriceCents: it.price, unitCostSnapshotCents: it.cost, currency: 'USD',
        })),
      );
      for (const it of soItems) {
        await tx
          .update(schema.inventoryBalances)
          .set({ reservedQty: sql`${schema.inventoryBalances.reservedQty} + ${it.qty}`, version: sql`${schema.inventoryBalances.version} + 1`, updatedAt: new Date() })
          .where(and(eq(schema.inventoryBalances.organizationId, ORG_ID), eq(schema.inventoryBalances.locationId, LOC_CENTRAL), eq(schema.inventoryBalances.productVariantId, it.variant)));
      }

      await tx.insert(schema.auditLogs).values({
        organizationId: ORG_ID, actorMemberId: M_SALES, actorRole: 'SALES_ASSOCIATE',
        action: 'SALES_ORDER_CONFIRMED', entityType: 'sales_orders', entityId: SO_CONFIRMED,
        reason: 'Stock reserved on sale confirmation (Rule 072)', correlationId: 'seed-demo-correlation',
      });
    });

    console.log(`[seed-demo] Seeded Nexus demo (${CATALOG.length} variants, 3 locations, 6 members, 4 POs, 1 confirmed SO).`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('[seed-demo] failed:', error);
  process.exitCode = 1;
});
