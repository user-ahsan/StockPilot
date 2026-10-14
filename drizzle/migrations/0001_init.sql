-- ============================================================================
-- StockPilot · 0001_init.sql
-- Enums, tables, keys, composite UNIQUE constraints and indexes.
-- CHECK constraints and immutability triggers live in 0002_triggers_and_checks.sql.
-- ============================================================================

-- ── Enumerated types ─────────────────────────────────────────────────
CREATE TYPE member_role AS ENUM (
  'OWNER', 'MANAGER', 'PROCUREMENT_OFFICER', 'WAREHOUSE_CLERK', 'SALES_ASSOCIATE', 'AUDITOR'
);

CREATE TYPE po_status AS ENUM (
  'DRAFT', 'SUBMITTED', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'REJECTED', 'CANCELLED'
);

CREATE TYPE so_status AS ENUM ('DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED');

CREATE TYPE movement_type AS ENUM (
  'PO_RECEIPT', 'SALE_RESERVATION', 'SALE_RELEASE', 'SALE_FULFILLMENT',
  'ADJUSTMENT_POSITIVE', 'ADJUSTMENT_NEGATIVE', 'TRANSFER_OUT', 'TRANSFER_IN'
);

CREATE TYPE adjustment_reason AS ENUM (
  'DAMAGED_IN_TRANSIT', 'WAREHOUSE_BREAKAGE', 'THEFT_SHRINKAGE', 'CYCLE_COUNT_SURPLUS',
  'CYCLE_COUNT_DEFICIT', 'WARRANTY_RETURN', 'EXPIRED_OBSOLETE'
);

CREATE TYPE adjustment_status AS ENUM ('APPLIED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- ── 1. organizations ─────────────────────────────────────────────────
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(64) NOT NULL,
  default_currency CHAR(3) NOT NULL DEFAULT 'USD',
  suspicious_adj_threshold_cents BIGINT NOT NULL DEFAULT 50000,
  suspicious_adj_pct_bps INTEGER NOT NULL DEFAULT 1000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organizations_slug_unique UNIQUE (slug)
);

-- ── 3. locations ─────────────────────────────────────────────────────
CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(120) NOT NULL,
  address TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT locations_org_code_unique UNIQUE (organization_id, code)
);

-- ── 2. members ───────────────────────────────────────────────────────
CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  password_hash TEXT NOT NULL,
  role member_role NOT NULL DEFAULT 'WAREHOUSE_CLERK',
  assigned_location_id UUID REFERENCES locations (id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT members_org_email_unique UNIQUE (organization_id, email)
);
CREATE INDEX idx_members_org_role ON members (organization_id, role);

-- ── 4. suppliers ─────────────────────────────────────────────────────
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(160) NOT NULL,
  contact_name VARCHAR(120) NOT NULL,
  order_email VARCHAR(255) NOT NULL,
  phone VARCHAR(40),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  lead_time_days INTEGER NOT NULL DEFAULT 7,
  encrypted_tax_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT suppliers_org_code_unique UNIQUE (organization_id, code)
);

-- ── 5. products ──────────────────────────────────────────────────────
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  name VARCHAR(200) NOT NULL,
  brand VARCHAR(100) NOT NULL,
  category VARCHAR(100) NOT NULL,
  description TEXT,
  image_url TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_products_org_cat ON products (organization_id, category);

-- ── 6. product_variants ──────────────────────────────────────────────
CREATE TABLE product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
  primary_supplier_id UUID NOT NULL REFERENCES suppliers (id) ON DELETE RESTRICT,
  sku VARCHAR(64) NOT NULL,
  barcode_upc VARCHAR(64),
  variant_name VARCHAR(200) NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  unit_cost_cents BIGINT NOT NULL,
  selling_price_cents BIGINT NOT NULL,
  reorder_point INTEGER NOT NULL DEFAULT 5,
  reorder_qty INTEGER NOT NULL DEFAULT 10,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT variants_org_sku_unique UNIQUE (organization_id, sku),
  CONSTRAINT variants_org_barcode_unique UNIQUE (organization_id, barcode_upc)
);
CREATE INDEX idx_variants_org_supplier ON product_variants (organization_id, primary_supplier_id);

-- ── 7. inventory_balances ────────────────────────────────────────────
CREATE TABLE inventory_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
  product_variant_id UUID NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  on_hand_qty INTEGER NOT NULL DEFAULT 0,
  reserved_qty INTEGER NOT NULL DEFAULT 0,
  available_qty INTEGER GENERATED ALWAYS AS (on_hand_qty - reserved_qty) STORED,
  last_movement_id BIGINT,
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT balances_org_loc_variant_unique UNIQUE (organization_id, location_id, product_variant_id)
);

-- ── 8. purchase_orders ───────────────────────────────────────────────
CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  po_number VARCHAR(32) NOT NULL,
  supplier_id UUID NOT NULL REFERENCES suppliers (id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
  status po_status NOT NULL DEFAULT 'DRAFT',
  currency CHAR(3) NOT NULL,
  subtotal_cents BIGINT NOT NULL DEFAULT 0,
  tax_cents BIGINT NOT NULL DEFAULT 0,
  shipping_cents BIGINT NOT NULL DEFAULT 0,
  total_cents BIGINT GENERATED ALWAYS AS (subtotal_cents + tax_cents + shipping_cents) STORED,
  is_auto_generated BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_member_id UUID NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  submitted_at TIMESTAMPTZ,
  approved_by_member_id UUID REFERENCES members (id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  supplier_notified_at TIMESTAMPTZ,
  expected_delivery_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT po_org_number_unique UNIQUE (organization_id, po_number)
);

-- ── 9. purchase_order_items ──────────────────────────────────────────
CREATE TABLE purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders (id) ON DELETE CASCADE,
  product_variant_id UUID NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  ordered_qty INTEGER NOT NULL,
  received_qty INTEGER NOT NULL DEFAULT 0,
  unit_cost_cents BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  line_total_cents BIGINT GENERATED ALWAYS AS (ordered_qty * unit_cost_cents) STORED,
  CONSTRAINT po_items_po_variant_unique UNIQUE (purchase_order_id, product_variant_id)
);

-- ── 10. sales_orders ─────────────────────────────────────────────────
CREATE TABLE sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  so_number VARCHAR(32) NOT NULL,
  location_id UUID NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
  customer_name VARCHAR(160) NOT NULL,
  customer_email VARCHAR(255),
  status so_status NOT NULL DEFAULT 'DRAFT',
  currency CHAR(3) NOT NULL,
  subtotal_cents BIGINT NOT NULL DEFAULT 0,
  tax_cents BIGINT NOT NULL DEFAULT 0,
  discount_cents BIGINT NOT NULL DEFAULT 0,
  total_cents BIGINT GENERATED ALWAYS AS (subtotal_cents + tax_cents - discount_cents) STORED,
  created_by_member_id UUID NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  fulfilled_by_member_id UUID REFERENCES members (id) ON DELETE RESTRICT,
  fulfilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT so_org_number_unique UNIQUE (organization_id, so_number)
);

-- ── 11. sales_order_items ────────────────────────────────────────────
CREATE TABLE sales_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  sales_order_id UUID NOT NULL REFERENCES sales_orders (id) ON DELETE CASCADE,
  product_variant_id UUID NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL,
  unit_price_cents BIGINT NOT NULL,
  unit_cost_snapshot_cents BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  line_total_cents BIGINT GENERATED ALWAYS AS (quantity * unit_price_cents) STORED,
  CONSTRAINT so_items_so_variant_unique UNIQUE (sales_order_id, product_variant_id)
);

-- ── 12. stock_movements (append-only) ────────────────────────────────
CREATE TABLE stock_movements (
  id BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
  product_variant_id UUID NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  movement_type movement_type NOT NULL,
  quantity_delta INTEGER NOT NULL,
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  unit_cost_cents BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  reference_type VARCHAR(40) NOT NULL,
  reference_id UUID NOT NULL,
  actor_member_id UUID NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  idempotency_key VARCHAR(128) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_movements_org_seq ON stock_movements (organization_id, id DESC);
CREATE INDEX idx_movements_variant_loc ON stock_movements (organization_id, product_variant_id, location_id, created_at DESC);
CREATE INDEX idx_movements_idempotency ON stock_movements (organization_id, idempotency_key);

-- ── 13. stock_adjustments ────────────────────────────────────────────
CREATE TABLE stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  adjustment_number VARCHAR(32) NOT NULL,
  location_id UUID NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
  product_variant_id UUID NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  quantity_delta INTEGER NOT NULL,
  unit_cost_snapshot_cents BIGINT NOT NULL,
  total_impact_cents BIGINT GENERATED ALWAYS AS (abs(quantity_delta) * unit_cost_snapshot_cents) STORED,
  currency CHAR(3) NOT NULL,
  reason_code adjustment_reason NOT NULL,
  reason_notes TEXT NOT NULL,
  status adjustment_status NOT NULL DEFAULT 'APPLIED',
  is_suspicious BOOLEAN NOT NULL DEFAULT FALSE,
  suspicious_trigger_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  actor_member_id UUID NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  reviewed_by_member_id UUID REFERENCES members (id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  idempotency_key VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT adjustments_org_number_unique UNIQUE (organization_id, adjustment_number),
  CONSTRAINT adjustments_org_idempotency_unique UNIQUE (organization_id, idempotency_key)
);

-- ── 14. audit_logs (append-only) ─────────────────────────────────────
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  actor_member_id UUID NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  actor_role member_role NOT NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  reason TEXT,
  before_state JSONB,
  after_state JSONB,
  ip_address VARCHAR(64),
  user_agent TEXT,
  correlation_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 15a. idempotency_keys ────────────────────────────────────────────
CREATE TABLE idempotency_keys (
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  idempotency_key VARCHAR(128) NOT NULL,
  actor_member_id UUID NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  request_method VARCHAR(10) NOT NULL,
  request_path VARCHAR(255) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL,
  response_status INTEGER,
  response_body JSONB,
  locked_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),
  PRIMARY KEY (organization_id, idempotency_key)
);

-- ── 15b. automation_outbox_events ────────────────────────────────────
CREATE TABLE automation_outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  event_type VARCHAR(64) NOT NULL,
  dedup_key VARCHAR(160) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT outbox_dedup_key_unique UNIQUE (dedup_key)
);
