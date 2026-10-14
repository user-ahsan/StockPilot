# CLAUDE.md — Master AI Agent Operational Manual for StockPilot

This document is the primary operational brain for Claude Code and all AI engineering agents referred from **[AGENTS.md](https://www.google.com/search?q=.%2FAGENTS.md)**. Read this file alongside **[rules.md](https://www.google.com/search?q=.%2Frules.md)** (150 strict rules) before executing any task.

## 1. Project Identity & Core Engineering Invariant

* **System:** **StockPilot** — Multi-location inventory, supplier, purchase order (PO), sales order (SO), and stock adjustment management monolith for retailers, electronics shops, computer hardware sellers, and distributors.
* **Architecture:** Single deployable **Next.js (`@latest`, App Router) + TypeScript (`@latest`, strict) + PostgreSQL (`postgres:latest`) + Drizzle ORM (`@latest`) + TanStack Query (`@latest`) + Shadcn UI (`@latest`)** monolith.
* **The Golden Invariant:** Stock balances (`inventory_balances.on_hand_qty` and `reserved_qty`) are **NEVER** mutated by setting a quantity from the frontend or via product catalog CRUD endpoints. Every change in stock MUST execute inside `InventoryLedgerService.applyMovement(tx, ...)` using pessimistic row locks (`SELECT ... FOR UPDATE` in deterministic ascending ID order), appending an immutable row to `stock_movements` and `audit_logs`, and enforcing client-supplied `Idempotency-Key` deduplication.

## 2. Strict CLI-Only Setup & Theme Commands (DO NOT EDIT CONFIG FILES)

Per **Rules 001–030 in `rules.md`**, you must NEVER manually edit `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `components.json`, `eslint.config.mjs`, or `src/app/globals.css`. Run these exact CLI commands using `@latest`:

```bash
# 1. Scaffold Next.js App Router Monolith (Latest)
npx create-next-app@latest stockpilot --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm

# 2. Initialize Shadcn UI (Latest) via CLI only
npx shadcn@latest init -d

# 3. Install the exact TweakCN Caffeine Theme via CLI only (NEVER edit globals.css manually)
npx shadcn@latest add https://tweakcn.com/r/themes/caffeine.json

# 4. Install Shadcn UI Primitives via CLI only (NEVER edit src/components/ui/* files)
npx shadcn@latest add button card table badge dialog sheet dropdown-menu select input textarea tabs tooltip alert sonner separator skeleton scroll-area progress avatar breadcrumb label popover command checkbox switch

# 5. Install Runtime & Backend Dependencies (@latest everywhere)
npm install drizzle-orm@latest pg@latest zod@latest @tanstack/react-query@latest @tanstack/react-table@latest recharts@latest lucide-react@latest dinero.js@latest papaparse@latest jose@latest @node-rs/argon2@latest next-themes@latest server-only@latest

# 6. Install Dev & Testing Dependencies (@latest everywhere)
npm install -D drizzle-kit@latest @types/pg@latest @types/papaparse@latest vitest@latest @playwright/test@latest tsx@latest
```

## 3. Styling & Component Composition Rules (`caffeine` Theme)

* **Theme Reference:** [TweakCN Caffeine Theme](https://www.google.com/search?q=https%3A%2F%2Ftweakcn.com%2Feditor%2Ftheme%3Ftheme%3Dcaffeine)
* **Forbidden:** Custom `.css` files, manual edits to `src/app/globals.css`, inline `style={{}}` color rules, raw Tailwind palette classes (`bg-slate-*`, `text-gray-*`, `bg-blue-*`, `bg-emerald-*`), or editing files inside `src/components/ui/*`.
* **Required:** Use only Shadcn semantic classes mapped to the `caffeine` theme tokens (`bg-background`, `text-foreground`, `bg-card`, `text-card-foreground`, `bg-popover`, `bg-primary`, `text-primary-foreground`, `bg-secondary`, `bg-muted`, `text-muted-foreground`, `bg-accent`, `bg-destructive`, `border-border`, `ring-ring`, `bg-sidebar`, and `var(--chart-1)`..`var(--chart-5)`).
* **Numeric Alignment:** Every SKU, barcode, quantity, signed movement delta (`+10`, `-2`), monetary figure (`USD $1,299.00`), and timestamp MUST include `font-mono tabular-nums`.

## 4. Database, Concurrency & Idempotency Rules

1. **Monetary Types:** All money columns are `BIGINT` in minor units (integer cents) paired with an explicit `CHAR(3)` ISO 4217 `currency` code. Zero floating-point math.
2. **Deterministic Row Locking (`src/server/db/locks.ts`):**
   * Always sort `product_variant_id` lexicographically (`ASC`) before issuing `SELECT ... FOR UPDATE` on `purchase_order_items`, `sales_order_items`, or `inventory_balances`.
   * Lock parent `purchase_orders` row (`FOR UPDATE`) during stock receipt to serialize concurrent warehouse clerks.
3. **Three-Layer Deduplication:**
   * **Frontend:** `useIdempotentMutation` generates a UUID `Idempotency-Key` when a mutation form opens and reuses that exact key across network drops or retries.
   * **Backend Middleware (`with-idempotency.ts`):** Verifies SHA-256 request payload hash in `idempotency_keys` table; replays cached `COMPLETED` response (`X-Idempotency-Replayed: true`) on duplicate retries; returns `409 Conflict` if `IN_PROGRESS` or `422` if key is reused with different body.
   * **Database Constraints:** Composite `UNIQUE` constraints on `(organization_id, sku)`, `(organization_id, location_id, product_variant_id)`, and `(organization_id, idempotency_key)`, plus `CHECK (on_hand_qty >= 0 AND reserved_qty >= 0 AND on_hand_qty >= reserved_qty)`.
4. **Adaptive Delta Polling (`/api/v1/sync/poll`):**
   * Polls `latestLedgerId` every `5000ms` (active operational views) or `15000ms` (idle catalog views), pauses when tab is hidden, and applies exponential backoff with jitter on network fluctuation.

## 5. Role-Based Access Control (RBAC) Summary

* `OWNER`: Full organization, member, pricing, PO approval, adjustment approval, and audit log control.
* `MANAGER`: Catalog/pricing control, PO approval/rejection, suspicious adjustment review, valuation reports.
* `PROCUREMENT_OFFICER`: Supplier management, PO drafting & submission (cannot self-approve POs or alter selling prices).
* `WAREHOUSE_CLERK`: PO stock receipt (`receive`) and controlled stock adjustment submission with mandatory reason code (cannot alter prices or approve POs).
* `SALES_ASSOCIATE`: Sales order drafting, stock reservation, and fulfillment (cannot alter catalog prices or raw stock quantities).
* `AUDITOR`: Strictly read-only access to all ledgers, reports, and `audit_logs`.

## 6. How to Execute Feature Tickets (Document 6)

1. Read the current atomic step in **Document 6 (`6. StockPilot - Sequential Atomic Feature Ticket List`)**.
2. Review the 5 Mental Model questions in **`rules.md` (Rules 046–060)**.
3. Implement only the target files listed in that ticket inside the monolithic file structure.
4. Run verification before marking the ticket complete:
   ```bash
   npx tsc --noEmit
   npm run lint
   npx vitest run
   ```
