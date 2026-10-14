-- ============================================================================
-- StockPilot · 0002_triggers_and_checks.sql
-- CHECK constraints (Rules 065–070, 106–109) + append-only immutability
-- triggers on stock_movements and audit_logs (Rules 133–134).
-- ============================================================================

-- ── CHECK constraints ────────────────────────────────────────────────

-- inventory_balances: no negative stock, never over-reserved (Rules 068–070)
ALTER TABLE inventory_balances
  ADD CONSTRAINT check_qty_validity
  CHECK (on_hand_qty >= 0 AND reserved_qty >= 0 AND on_hand_qty >= reserved_qty);

-- purchase_order_items: ordered > 0 and 0 <= received <= ordered (Rules 078)
ALTER TABLE purchase_order_items
  ADD CONSTRAINT check_ordered_qty_positive CHECK (ordered_qty > 0);
ALTER TABLE purchase_order_items
  ADD CONSTRAINT check_received_within_ordered CHECK (received_qty >= 0 AND received_qty <= ordered_qty);

-- stock_movements: nonzero delta and a self-consistent running balance (Rule 065)
ALTER TABLE stock_movements
  ADD CONSTRAINT check_movement_delta_nonzero CHECK (quantity_delta <> 0);
ALTER TABLE stock_movements
  ADD CONSTRAINT check_movement_balance_before CHECK (balance_before >= 0);
ALTER TABLE stock_movements
  ADD CONSTRAINT check_movement_balance_after
  CHECK (balance_after >= 0 AND balance_after = balance_before + quantity_delta);

-- stock_adjustments: nonzero delta, mandatory detailed reason (Rule 131)
ALTER TABLE stock_adjustments
  ADD CONSTRAINT check_adjustment_delta_nonzero CHECK (quantity_delta <> 0);
ALTER TABLE stock_adjustments
  ADD CONSTRAINT check_reason_notes_length CHECK (char_length(trim(reason_notes)) >= 15);

-- sales_orders: total may not go negative
ALTER TABLE sales_orders
  ADD CONSTRAINT check_so_total_nonnegative CHECK (subtotal_cents + tax_cents - discount_cents >= 0);

-- Monetary currency codes must be ISO 4217 shaped (Rule 108)
ALTER TABLE organizations
  ADD CONSTRAINT check_org_currency CHECK (default_currency ~ '^[A-Z]{3}$');
ALTER TABLE suppliers
  ADD CONSTRAINT check_supplier_currency CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE product_variants
  ADD CONSTRAINT check_variant_currency CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE purchase_orders
  ADD CONSTRAINT check_po_currency CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE purchase_order_items
  ADD CONSTRAINT check_po_item_currency CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE sales_orders
  ADD CONSTRAINT check_so_currency CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE sales_order_items
  ADD CONSTRAINT check_so_item_currency CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE stock_movements
  ADD CONSTRAINT check_movement_currency CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE stock_adjustments
  ADD CONSTRAINT check_adjustment_currency CHECK (currency ~ '^[A-Z]{3}$');

-- Infrastructure status enums (Rules 091–096, 140)
ALTER TABLE idempotency_keys
  ADD CONSTRAINT check_idempotency_status CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED'));
ALTER TABLE automation_outbox_events
  ADD CONSTRAINT check_outbox_status CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'));
ALTER TABLE automation_outbox_events
  ADD CONSTRAINT check_outbox_event_type
  CHECK (event_type IN ('LOW_STOCK_ALERT', 'AUTO_DRAFT_PO', 'SUPPLIER_PO_EMAIL', 'SUSPICIOUS_ADJ_ALERT'));

-- ── Append-only immutability triggers (Rules 133–134) ────────────────
CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Immutable Ledger Violation: Modifications or deletions to % are strictly forbidden.', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation',
          HINT = 'Ledger records must remain permanent for audit compliance.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_immutable_stock_movements
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

CREATE TRIGGER trg_immutable_audit_logs
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
