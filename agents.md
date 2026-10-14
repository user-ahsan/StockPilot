# AGENTS.md — Universal AI Coding Agent Entrypoint for StockPilot

> **MANDATORY FIRST STEP FOR ALL AI AGENTS (Cursor, Claude Code, Windsurf, Copilot, Devin, OpenHands, Codex):**
> Before planning, scaffolding, editing, or running any command in this repository, you MUST read **[CLAUDE.md](https://www.google.com/search?q=.%2FCLAUDE.md)** and **[rules.md](https://www.google.com/search?q=.%2Frules.md)** in their entirety.

## 1. Canonical Governance Hierarchy

All AI agents operating in the `stockpilot/` monolith are bound by the following strict source-of-truth hierarchy:

1. **[CLAUDE.md](https://www.google.com/search?q=.%2FCLAUDE.md)** — Master AI Agent Operational Manual, CLI Command Playbook, Tech Stack (`@latest`), and Architectural Invariants.
2. **[rules.md](https://www.google.com/search?q=.%2Frules.md)** — The **150 Strict Engineering, Mental-Model, Config-Lock & CLI-Only Shadcn Rules** (Rules 001–150).
3. **Specification Suite (Documents 1–6):**
   * **Document 1 — Product Requirements Document (PRD):** Domain workflows, 6 RBAC roles, and end-to-end business transactions.
   * **Document 2 — Technical Architecture & Monolithic File Structure:** Exact monolithic file tree, adaptive polling (`/api/v1/sync/poll`), idempotency pipeline, and `dev`/`demo`/`prod` environment variables.
   * **Document 3 — Security, Access Control & Concurrency Document:** Argon2id/JWT auth, RBAC enforcement table, `SELECT ... FOR UPDATE` row locking, and CSV injection hardening.
   * **Document 4 — Frontend Specification & UI Style Guide:** **[TweakCN Caffeine Theme](https://www.google.com/search?q=https%3A%2F%2Ftweakcn.com%2Feditor%2Ftheme%3Ftheme%3Dcaffeine)** semantic token mapping, tabular typography, and screen layouts.
   * **Document 5 — Database Schema & Transactional Integrity:** All 15 PostgreSQL tables, `BIGINT` minor currency units, `CHECK` constraints, SQL lock blueprints, and immutability triggers.
   * **Document 6 — Sequential Atomic Feature Ticket List:** Step-by-step atomic build order (`Step 1` through `Step 21`).

## 2. Top 5 Non-Negotiable Red Lines for Every Agent

* **RED LINE 1 — ZERO CONFIG FILE TAMPERING (Rules 001–015):**
  Never manually edit `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `components.json`, `eslint.config.mjs`, `drizzle.config.ts`, or `src/app/globals.css`.
* **RED LINE 2 — SHADCN & TWEAKCN `caffeine` THEME VIA CLI ONLY (Rules 016–030):**
  Never write custom CSS or hardcoded Tailwind palette colors (`bg-slate-*`, `bg-blue-*`). Install the theme exclusively via:
  ```bash
  npx shadcn@latest init -d
  npx shadcn@latest add https://tweakcn.com/r/themes/caffeine.json
  ```
  And add components strictly via `npx shadcn@latest add <component>`. Never edit files inside `src/components/ui/*`.
* **RED LINE 3 — ALWAYS USE `@latest` PACKAGES (Rules 031–045):**
  Never pin outdated framework or library versions. Always install `@latest` via CLI and use modern Next.js App Router async APIs (`await params`, `await searchParams`, `await cookies()`).
* **RED LINE 4 — ZERO BLIND STOCK UPDATES (Rules 061–090):**
  Never update inventory quantities directly from the frontend or catalog metadata endpoints. Every stock mutation must execute inside `InventoryLedgerService` under a PostgreSQL `BEGIN ... SELECT ... FOR UPDATE ... COMMIT` transaction that appends to `stock_movements` and `audit_logs`.
* **RED LINE 5 — ATOMIC SEQUENTIAL TICKET EXECUTION (Rule 150):**
  Work on exactly one ticket from Document 6 at a time. Run `npx tsc --noEmit`, `npm run lint`, and the ticket's automated test suite before moving to the next ticket.

## 3. Agent Routing Instructions

* **Proceed immediately to [CLAUDE.md](https://www.google.com/search?q=.%2FCLAUDE.md)** for the exact CLI initialization commands, database transaction blueprints, and pre-commit verification workflow.
