# Northline Copilot

A reference implementation of a **billing support workspace** for Northline, a fictional B2B SaaS company. The application helps operators investigate disputes, retrieve policy context, and **queue refunds for human review**. It does not execute payouts: eligible requests create a `pending` record; ineligible requests are rejected with no database write. All customer and billing data in the repository is **synthetic**.

## Overview

Northline Copilot is designed as a **two-panel workspace**: conversational investigation on one side and structured account context (charges, policy citations, pending queue) on the other. A language model assists with lookup and explanation; **refund eligibility is enforced in TypeScript** (`lib/refundRules.ts`), not by the model, SQL, or static prompt text. Writes to the pending queue require explicit human confirmation in the web flow (and equivalent confirmation in the planned MCP interface).

**Target stack:** Next.js (App Router), Supabase Postgres, pgvector for policy retrieval, OpenAI invoked server-side only, a shared tool layer consumed by both the web app and an MCP stdio server, deployed on Vercel and Supabase.

## Refund workflow

1. **Read** account and charge data from Postgres (Supabase client for reads).
2. **Evaluate** eligibility via `requestRefund` in `lib/refundRules.ts`: annual plans within 30 days, monthly within 14 days, duplicate successful charges on the same invoice, and rejection when a pending row already exists for the charge.
3. **Persist** only on accept: `queueRefund` in `lib/refunds.ts` runs a single Postgres transaction (session-mode `DATABASE_URL`), invokes the rules, and inserts at most one row into `pending_refunds`. A partial unique index prevents duplicate pending rows for the same charge.

The model may propose or preview outcomes; it is not the authority on eligibility or payment.

## Implementation status

The **domain layer, database layer, Next.js app shell, workspace layout, demo login, and account context read** are in place. `/workspace` is chat on the left and context on the right. The Account and Charges panels load one account through `GET /api/accounts/[accountId]`, which checks the session cookie and calls `getAccount`. Chat, policy citations, and the pending queue stay empty. `/login` posts a shared demo password and sets an HttpOnly session cookie. `GET /api/protected` returns 401 without that cookie and 200 after login. The pending queue is the next step (M12). Present capabilities:

| Component | Responsibility |
| --- | --- |
| `lib/refundRules.ts` | Refund eligibility (unit-tested, in-memory). |
| `lib/accounts.ts`, `lib/supabase.ts` | Read path for accounts and charges (service role, server-only). |
| `lib/postgres.ts`, `lib/refunds.ts` | Write path: transactional `queueRefund`. |
| `lib/session.ts` | Demo password check and signed session token. No user table. |
| `supabase/migrations/` | Schema, seed data, grants. |
| `tests/integration/` | Persistence and concurrency checks against Postgres. |
| `scripts/` | Manual verification against a linked Supabase project. |
| `app/` | Next.js App Router: home, `/workspace`, `/login`, `POST /api/login`, `GET /api/protected`, `GET /api/accounts/[accountId]`. |
| `components/` | Workspace panels. Account and Charges show facts from the account route. Policy citations, the pending queue, and chat stay empty. Login form. |

Build history and remaining milestones: **[MILESTONES.md](./MILESTONES.md)** (M01–M11 complete; M12 next).

## Demo accounts (seed)

Three canonical scenarios; refund windows are evaluated against **2026-10-22** in tests and scripts:

| Account | Scenario |
| --- | --- |
| `acct-annual-ok` | Annual charge within the 30-day window — eligible to queue. |
| `acct-monthly-late` | Monthly charge outside the 14-day window — rejected, no row. |
| `acct-double` | Two successful charges on one invoice — duplicate charge eligible to queue. |

Detailed rule coverage: `lib/refundRules.test.ts` and M01 in [MILESTONES.md](./MILESTONES.md).

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and configure (server-only variables; do not expose secrets via `NEXT_PUBLIC_`):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — read API.
   - `DATABASE_URL` — Postgres **session** pooler on **port 5432** (not 6543 transaction pooler). Percent-encode special characters in the password.
   - `DEMO_PASSWORD`, `SESSION_SECRET` — shared demo login, and the key that signs the HttpOnly session cookie.

Apply schema to a linked project:

```bash
supabase migration list --linked
supabase db push    # when a new migration file is ready
```

Optional local Postgres: `supabase start` / `supabase stop`. Development in this repository typically uses a hosted linked project.

## Commands

```bash
npm run dev                   # local Next.js app; open /workspace
npm test                      # refund rules (no database)
npm run test:integration      # queueRefund against Postgres (requires DATABASE_URL)
npm run print:acct-double     # read acct-double from Postgres
npm run queue:refund-cases    # manual write-path scenarios on 2026-10-22
```

`queue:refund-cases` leaves two pending rows (`ch_annual_1`, `ch_double_dup`) unless cleared. Integration tests delete pending rows for `ch_annual_1`, `ch_monthly_1`, and `ch_double_dup` before and after each run.

## Project layout

Business logic resides in **`lib/`**. **`app/`** is the Next.js shell: a root layout, a plain home page, the `/workspace` route, the demo login, and the account read route. **`components/`** holds the two-column workspace (chat on the left, context panels on the right), the account lookup that fills Account and Charges, and the login form. Session sign and verify live in **`lib/session.ts`**. Integration tests live under **`tests/integration/`**. Conventions and folder introduction order: **Project layout** in [MILESTONES.md](./MILESTONES.md).
