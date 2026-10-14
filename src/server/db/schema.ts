/**
 * Complete StockPilot PostgreSQL schema (Document 5 §5.2–5.3).
 *
 * Money is always `bigint` minor units (cents) — never float. Balances are only
 * ever mutated by `InventoryLedgerService`; the append-only ledgers are protected
 * by DB triggers (see drizzle/migrations/0002_triggers_and_checks.sql).
 */
import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const cents = (name: string) => bigint(name, { mode: 'number' });
const tstz = (name: string) => timestamp(name, { withTimezone: true });
const nowTstz = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();

// ── 5.2 Enumerated types ──────────────────────────────────────────────
export const memberRoleEnum = pgEnum('member_role', [
  'OWNER',
  'MANAGER',
  'PROCUREMENT_OFFICER',
  'WAREHOUSE_CLERK',
  'SALES_ASSOCIATE',
  'AUDITOR',
]);

export const poStatusEnum = pgEnum('po_status', [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'REJECTED',
  'CANCELLED',
]);

export const soStatusEnum = pgEnum('so_status', ['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED']);

export const movementTypeEnum = pgEnum('movement_type', [
  'PO_RECEIPT',
  'SALE_RESERVATION',
  'SALE_RELEASE',
  'SALE_FULFILLMENT',
  'ADJUSTMENT_POSITIVE',
  'ADJUSTMENT_NEGATIVE',
  'TRANSFER_OUT',
  'TRANSFER_IN',
]);

export const adjustmentReasonEnum = pgEnum('adjustment_reason', [
  'DAMAGED_IN_TRANSIT',
  'WAREHOUSE_BREAKAGE',
  'THEFT_SHRINKAGE',
  'CYCLE_COUNT_SURPLUS',
  'CYCLE_COUNT_DEFICIT',
  'WARRANTY_RETURN',
  'EXPIRED_OBSOLETE',
]);

export const adjustmentStatusEnum = pgEnum('adjustment_status', [
  'APPLIED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
]);

// ── 1. organizations ──────────────────────────────────────────────────
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 64 }).notNull(),
    defaultCurrency: char('default_currency', { length: 3 }).notNull().default('USD'),
    suspiciousAdjThresholdCents: cents('suspicious_adj_threshold_cents').notNull().default(50000),
    suspiciousAdjPctBps: integer('suspicious_adj_pct_bps').notNull().default(1000),
    createdAt: nowTstz('created_at'),
    updatedAt: nowTstz('updated_at'),
  },
  (t) => [unique('organizations_slug_unique').on(t.slug)],
);

// ── 3. locations (defined before members — members reference it) ──────
export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    address: text('address').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: nowTstz('created_at'),
  },
  (t) => [unique('locations_org_code_unique').on(t.organizationId, t.code)],
);

// ── 2. members ────────────────────────────────────────────────────────
export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    fullName: varchar('full_name', { length: 120 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: memberRoleEnum('role').notNull().default('WAREHOUSE_CLERK'),
    assignedLocationId: uuid('assigned_location_id').references(() => locations.id, {
      onDelete: 'set null',
    }),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: tstz('last_login_at'),
    createdAt: nowTstz('created_at'),
  },
  (t) => [
    unique('members_org_email_unique').on(t.organizationId, t.email),
    index('idx_members_org_role').on(t.organizationId, t.role),
  ],
);

// ── 4. suppliers ──────────────────────────────────────────────────────
export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    contactName: varchar('contact_name', { length: 120 }).notNull(),
    orderEmail: varchar('order_email', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 40 }),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    leadTimeDays: integer('lead_time_days').notNull().default(7),
    encryptedTaxId: text('encrypted_tax_id'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: nowTstz('created_at'),
  },
  (t) => [unique('suppliers_org_code_unique').on(t.organizationId, t.code)],
);

// ── 5. products ───────────────────────────────────────────────────────
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 200 }).notNull(),
    brand: varchar('brand', { length: 100 }).notNull(),
    category: varchar('category', { length: 100 }).notNull(),
    description: text('description'),
    imageUrl: text('image_url'),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: nowTstz('created_at'),
    updatedAt: nowTstz('updated_at'),
  },
  (t) => [index('idx_products_org_cat').on(t.organizationId, t.category)],
);

// ── 6. product_variants ───────────────────────────────────────────────
export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    primarySupplierId: uuid('primary_supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    sku: varchar('sku', { length: 64 }).notNull(),
    barcodeUpc: varchar('barcode_upc', { length: 64 }),
    variantName: varchar('variant_name', { length: 200 }).notNull(),
    attributes: jsonb('attributes').notNull().default({}),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    unitCostCents: cents('unit_cost_cents').notNull(),
    sellingPriceCents: cents('selling_price_cents').notNull(),
    reorderPoint: integer('reorder_point').notNull().default(5),
    reorderQty: integer('reorder_qty').notNull().default(10),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: nowTstz('created_at'),
    updatedAt: nowTstz('updated_at'),
  },
  (t) => [
    unique('variants_org_sku_unique').on(t.organizationId, t.sku),
    unique('variants_org_barcode_unique').on(t.organizationId, t.barcodeUpc),
    index('idx_variants_org_supplier').on(t.organizationId, t.primarySupplierId),
  ],
);

// ── 7. inventory_balances (materialized, row-locked) ──────────────────
export const inventoryBalances = pgTable(
  'inventory_balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    productVariantId: uuid('product_variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    onHandQty: integer('on_hand_qty').notNull().default(0),
    reservedQty: integer('reserved_qty').notNull().default(0),
    availableQty: integer('available_qty').generatedAlwaysAs(sql`on_hand_qty - reserved_qty`),
    lastMovementId: bigint('last_movement_id', { mode: 'number' }),
    version: bigint('version', { mode: 'number' }).notNull().default(1),
    updatedAt: nowTstz('updated_at'),
  },
  (t) => [unique('balances_org_loc_variant_unique').on(t.organizationId, t.locationId, t.productVariantId)],
);

// ── 8. purchase_orders ────────────────────────────────────────────────
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    poNumber: varchar('po_number', { length: 32 }).notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    status: poStatusEnum('status').notNull().default('DRAFT'),
    currency: char('currency', { length: 3 }).notNull(),
    subtotalCents: cents('subtotal_cents').notNull().default(0),
    taxCents: cents('tax_cents').notNull().default(0),
    shippingCents: cents('shipping_cents').notNull().default(0),
    totalCents: cents('total_cents').generatedAlwaysAs(
      sql`subtotal_cents + tax_cents + shipping_cents`,
    ),
    isAutoGenerated: boolean('is_auto_generated').notNull().default(false),
    createdByMemberId: uuid('created_by_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    submittedAt: tstz('submitted_at'),
    approvedByMemberId: uuid('approved_by_member_id').references(() => members.id, {
      onDelete: 'restrict',
    }),
    approvedAt: tstz('approved_at'),
    supplierNotifiedAt: tstz('supplier_notified_at'),
    expectedDeliveryDate: date('expected_delivery_date'),
    notes: text('notes'),
    createdAt: nowTstz('created_at'),
    updatedAt: nowTstz('updated_at'),
  },
  (t) => [unique('po_org_number_unique').on(t.organizationId, t.poNumber)],
);

// ── 9. purchase_order_items ───────────────────────────────────────────
export const purchaseOrderItems = pgTable(
  'purchase_order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    productVariantId: uuid('product_variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    orderedQty: integer('ordered_qty').notNull(),
    receivedQty: integer('received_qty').notNull().default(0),
    unitCostCents: cents('unit_cost_cents').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    lineTotalCents: cents('line_total_cents').generatedAlwaysAs(sql`ordered_qty * unit_cost_cents`),
  },
  (t) => [unique('po_items_po_variant_unique').on(t.purchaseOrderId, t.productVariantId)],
);

// ── 10. sales_orders ──────────────────────────────────────────────────
export const salesOrders = pgTable(
  'sales_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    soNumber: varchar('so_number', { length: 32 }).notNull(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    customerName: varchar('customer_name', { length: 160 }).notNull(),
    customerEmail: varchar('customer_email', { length: 255 }),
    status: soStatusEnum('status').notNull().default('DRAFT'),
    currency: char('currency', { length: 3 }).notNull(),
    subtotalCents: cents('subtotal_cents').notNull().default(0),
    taxCents: cents('tax_cents').notNull().default(0),
    discountCents: cents('discount_cents').notNull().default(0),
    totalCents: cents('total_cents').generatedAlwaysAs(
      sql`subtotal_cents + tax_cents - discount_cents`,
    ),
    createdByMemberId: uuid('created_by_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    fulfilledByMemberId: uuid('fulfilled_by_member_id').references(() => members.id, {
      onDelete: 'restrict',
    }),
    fulfilledAt: tstz('fulfilled_at'),
    createdAt: nowTstz('created_at'),
    updatedAt: nowTstz('updated_at'),
  },
  (t) => [unique('so_org_number_unique').on(t.organizationId, t.soNumber)],
);

// ── 11. sales_order_items ─────────────────────────────────────────────
export const salesOrderItems = pgTable(
  'sales_order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    salesOrderId: uuid('sales_order_id')
      .notNull()
      .references(() => salesOrders.id, { onDelete: 'cascade' }),
    productVariantId: uuid('product_variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    unitPriceCents: cents('unit_price_cents').notNull(),
    unitCostSnapshotCents: cents('unit_cost_snapshot_cents').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    lineTotalCents: cents('line_total_cents').generatedAlwaysAs(sql`quantity * unit_price_cents`),
  },
  (t) => [unique('so_items_so_variant_unique').on(t.salesOrderId, t.productVariantId)],
);

// ── 12. stock_movements (append-only ledger) ──────────────────────────
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    productVariantId: uuid('product_variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    movementType: movementTypeEnum('movement_type').notNull(),
    quantityDelta: integer('quantity_delta').notNull(),
    balanceBefore: integer('balance_before').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    unitCostCents: cents('unit_cost_cents').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    referenceType: varchar('reference_type', { length: 40 }).notNull(),
    referenceId: uuid('reference_id').notNull(),
    actorMemberId: uuid('actor_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    notes: text('notes'),
    createdAt: nowTstz('created_at'),
  },
  (t) => [
    index('idx_movements_org_seq').on(t.organizationId, t.id),
    index('idx_movements_variant_loc').on(t.organizationId, t.productVariantId, t.locationId),
    index('idx_movements_idempotency').on(t.organizationId, t.idempotencyKey),
  ],
);

// ── 13. stock_adjustments ─────────────────────────────────────────────
export const stockAdjustments = pgTable(
  'stock_adjustments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    adjustmentNumber: varchar('adjustment_number', { length: 32 }).notNull(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    productVariantId: uuid('product_variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    quantityDelta: integer('quantity_delta').notNull(),
    unitCostSnapshotCents: cents('unit_cost_snapshot_cents').notNull(),
    totalImpactCents: cents('total_impact_cents').generatedAlwaysAs(
      sql`abs(quantity_delta) * unit_cost_snapshot_cents`,
    ),
    currency: char('currency', { length: 3 }).notNull(),
    reasonCode: adjustmentReasonEnum('reason_code').notNull(),
    reasonNotes: text('reason_notes').notNull(),
    status: adjustmentStatusEnum('status').notNull().default('APPLIED'),
    isSuspicious: boolean('is_suspicious').notNull().default(false),
    suspiciousTriggerReasons: jsonb('suspicious_trigger_reasons').notNull().default([]),
    actorMemberId: uuid('actor_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    reviewedByMemberId: uuid('reviewed_by_member_id').references(() => members.id, {
      onDelete: 'restrict',
    }),
    reviewedAt: tstz('reviewed_at'),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    createdAt: nowTstz('created_at'),
  },
  (t) => [
    unique('adjustments_org_number_unique').on(t.organizationId, t.adjustmentNumber),
    unique('adjustments_org_idempotency_unique').on(t.organizationId, t.idempotencyKey),
  ],
);

// ── 14. audit_logs (append-only) ──────────────────────────────────────
export const auditLogs = pgTable('audit_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'restrict' }),
  actorMemberId: uuid('actor_member_id')
    .notNull()
    .references(() => members.id, { onDelete: 'restrict' }),
  actorRole: memberRoleEnum('actor_role').notNull(),
  action: varchar('action', { length: 80 }).notNull(),
  entityType: varchar('entity_type', { length: 64 }).notNull(),
  entityId: varchar('entity_id', { length: 64 }).notNull(),
  reason: text('reason'),
  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state'),
  ipAddress: varchar('ip_address', { length: 64 }),
  userAgent: text('user_agent'),
  correlationId: varchar('correlation_id', { length: 64 }).notNull(),
  createdAt: nowTstz('created_at'),
});

// ── 15a. idempotency_keys ─────────────────────────────────────────────
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    actorMemberId: uuid('actor_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    requestMethod: varchar('request_method', { length: 10 }).notNull(),
    requestPath: varchar('request_path', { length: 255 }).notNull(),
    requestHash: char('request_hash', { length: 64 }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    lockedUntil: tstz('locked_until').notNull(),
    createdAt: nowTstz('created_at'),
    expiresAt: tstz('expires_at')
      .notNull()
      .default(sql`now() + interval '48 hours'`),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.idempotencyKey] })],
);

// ── 15b. automation_outbox_events ─────────────────────────────────────
export const automationOutboxEvents = pgTable(
  'automation_outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    dedupKey: varchar('dedup_key', { length: 160 }).notNull(),
    payload: jsonb('payload').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: nowTstz('next_attempt_at'),
    processedAt: tstz('processed_at'),
    createdAt: nowTstz('created_at'),
  },
  (t) => [unique('outbox_dedup_key_unique').on(t.dedupKey)],
);

// ── Relations ─────────────────────────────────────────────────────────
export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(members),
  locations: many(locations),
  suppliers: many(suppliers),
  products: many(products),
  productVariants: many(productVariants),
}));

export const locationsRelations = relations(locations, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [locations.organizationId],
    references: [organizations.id],
  }),
  balances: many(inventoryBalances),
  purchaseOrders: many(purchaseOrders),
  salesOrders: many(salesOrders),
}));

export const membersRelations = relations(members, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [members.organizationId],
    references: [organizations.id],
  }),
  assignedLocation: one(locations, {
    fields: [members.assignedLocationId],
    references: [locations.id],
  }),
  auditLogs: many(auditLogs),
}));

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [suppliers.organizationId],
    references: [organizations.id],
  }),
  variants: many(productVariants),
  purchaseOrders: many(purchaseOrders),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [products.organizationId],
    references: [organizations.id],
  }),
  variants: many(productVariants),
}));

export const productVariantsRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
  primarySupplier: one(suppliers, {
    fields: [productVariants.primarySupplierId],
    references: [suppliers.id],
  }),
  balances: many(inventoryBalances),
  movements: many(stockMovements),
  purchaseOrderItems: many(purchaseOrderItems),
  salesOrderItems: many(salesOrderItems),
}));

export const inventoryBalancesRelations = relations(inventoryBalances, ({ one }) => ({
  organization: one(organizations, {
    fields: [inventoryBalances.organizationId],
    references: [organizations.id],
  }),
  location: one(locations, {
    fields: [inventoryBalances.locationId],
    references: [locations.id],
  }),
  variant: one(productVariants, {
    fields: [inventoryBalances.productVariantId],
    references: [productVariants.id],
  }),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [purchaseOrders.organizationId],
    references: [organizations.id],
  }),
  supplier: one(suppliers, {
    fields: [purchaseOrders.supplierId],
    references: [suppliers.id],
  }),
  location: one(locations, {
    fields: [purchaseOrders.locationId],
    references: [locations.id],
  }),
  items: many(purchaseOrderItems),
}));

export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderItems.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  variant: one(productVariants, {
    fields: [purchaseOrderItems.productVariantId],
    references: [productVariants.id],
  }),
}));

export const salesOrdersRelations = relations(salesOrders, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [salesOrders.organizationId],
    references: [organizations.id],
  }),
  location: one(locations, { fields: [salesOrders.locationId], references: [locations.id] }),
  items: many(salesOrderItems),
}));

export const salesOrderItemsRelations = relations(salesOrderItems, ({ one }) => ({
  salesOrder: one(salesOrders, {
    fields: [salesOrderItems.salesOrderId],
    references: [salesOrders.id],
  }),
  variant: one(productVariants, {
    fields: [salesOrderItems.productVariantId],
    references: [productVariants.id],
  }),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  location: one(locations, { fields: [stockMovements.locationId], references: [locations.id] }),
  variant: one(productVariants, {
    fields: [stockMovements.productVariantId],
    references: [productVariants.id],
  }),
  actor: one(members, { fields: [stockMovements.actorMemberId], references: [members.id] }),
}));

export const stockAdjustmentsRelations = relations(stockAdjustments, ({ one }) => ({
  location: one(locations, {
    fields: [stockAdjustments.locationId],
    references: [locations.id],
  }),
  variant: one(productVariants, {
    fields: [stockAdjustments.productVariantId],
    references: [productVariants.id],
  }),
  actor: one(members, {
    fields: [stockAdjustments.actorMemberId],
    references: [members.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  organization: one(organizations, {
    fields: [auditLogs.organizationId],
    references: [organizations.id],
  }),
  actor: one(members, { fields: [auditLogs.actorMemberId], references: [members.id] }),
}));

// ── Inferred TypeScript types ─────────────────────────────────────────
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;
export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductVariant = typeof productVariants.$inferSelect;
export type NewProductVariant = typeof productVariants.$inferInsert;
export type InventoryBalance = typeof inventoryBalances.$inferSelect;
export type NewInventoryBalance = typeof inventoryBalances.$inferInsert;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert;
export type PurchaseOrderItem = typeof purchaseOrderItems.$inferSelect;
export type NewPurchaseOrderItem = typeof purchaseOrderItems.$inferInsert;
export type SalesOrder = typeof salesOrders.$inferSelect;
export type NewSalesOrder = typeof salesOrders.$inferInsert;
export type SalesOrderItem = typeof salesOrderItems.$inferSelect;
export type NewSalesOrderItem = typeof salesOrderItems.$inferInsert;
export type StockMovement = typeof stockMovements.$inferSelect;
export type NewStockMovement = typeof stockMovements.$inferInsert;
export type StockAdjustment = typeof stockAdjustments.$inferSelect;
export type NewStockAdjustment = typeof stockAdjustments.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
export type AutomationOutboxEvent = typeof automationOutboxEvents.$inferSelect;
export type NewAutomationOutboxEvent = typeof automationOutboxEvents.$inferInsert;
