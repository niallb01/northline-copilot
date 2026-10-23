# Northline Copilot

A support workspace for **Northline**, a fictional B2B SaaS company. An agent investigates billing disputes: look up the customer, read refund policy, and—when the rules allow—**queue a refund for a human to review**. This project **never sends money**. `pending` means “waiting for a person”; `rejected` means nothing was saved. All accounts and charges are **synthetic demo data**.

## What you are building

The end product is a **two-panel web app**: chat on the left, account/charges/policy/pending context on the right. An **LLM helps investigate** (look up data, search policy, explain). **TypeScript in `lib/` decides refunds**—not the model, not SQL, not copy-pasted policy text. A **human confirms** before a pending row is written. The same rules and tools will also run from an **MCP server** in Cursor later.

**Stack (planned):** Next.js, Supabase Postgres, pgvector for policy snippets, OpenAI on the server only, one shared tool layer, MCP stdio, deploy on Vercel + Supabase.

## How refunds are supposed to work

1. **Read** account and charges from Postgres.
2. **Decide** with `requestRefund` in `lib/refundRules.ts` (annual ≤ 30 days, monthly ≤ 14 days, duplicate charge on same invoice, no second pending for the same charge).
3. **Write** only when eligible: `queueRefund` in `lib/refunds.ts` runs one Postgres transaction, calls those rules, and inserts **at most one** row into `pending_refunds`. The database also blocks two pending rows for the same charge via a unique index.

The model may *suggest* or *preview*; it must not be the source of truth for eligibility or payment.

## What exists in the repo today

There is **no website or chat UI yet** (that starts at M09). What you have now is the **shared brain** and database:

| Piece | Role |
| --- | --- |
| `lib/refundRules.ts` | Refund eligibility (unit-tested, in-memory). |
| `lib/accounts.ts` + `lib/supabase.ts` | Read accounts/charges via Supabase (server key). |
| `lib/postgres.ts` + `lib/refunds.ts` | Write path: direct Postgres session + `queueRefund`. |
| `supabase/migrations/` | `accounts`, `charges`, `pending_refunds`, seed data, grants. |
| `scripts/` | Manual checks against your linked Supabase project. |

**Progress:** M01–M08 done → next is **M09** (Next.js App Router skeleton: a plain home page, no chat). Step-by-step plan: **[MILESTONES.md](./MILESTONES.md)**.

## Demo accounts (seed)

Three fixed stories; dates make sense when “today” is **2026-10-22**:

| Account | Story |
| --- | --- |
| `acct-annual-ok` | Annual charge inside the 30-day window → can queue pending. |
| `acct-monthly-late` | Monthly charge too old → reject, no row. |
| `acct-double` | Two successful charges on one invoice → the duplicate can queue pending. |

Refund window table and charge-level outcomes are in **M01** in [MILESTONES.md](./MILESTONES.md) and in `lib/refundRules.test.ts`.

## Local setup

1. `npm install`
2. Copy `.env.example` → `.env` and fill in (server only—**never** `NEXT_PUBLIC_`):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — reads through the Supabase API.
   - `DATABASE_URL` — **session** pooler on **port 5432** (not 6543) for refund writes. Percent-encode special characters in the password.

Linked Supabase project ref is in the repo workflow docs; schema is applied with:

```bash
supabase migration list --linked
supabase db push    # when a new migration file is ready
```

Optional local Postgres via Docker: `supabase start` / `supabase stop`. Day-to-day work in this repo uses the **hosted** linked project.

## Commands

```bash
npm test                      # refund rules (no database)
npm run test:integration      # queueRefund against Postgres (needs DATABASE_URL)
npm run print:acct-double     # read acct-double from Postgres
npm run queue:refund-cases    # four M07 write-path checks on 2026-10-22
```

After `queue:refund-cases`, expect **two** pending rows in Supabase (`ch_annual_1`, `ch_double_dup`) until you clear or re-run the script (it resets pending for those charges first). `npm run test:integration` also deletes pending rows for `ch_annual_1`, `ch_monthly_1`, and `ch_double_dup` before and after its cases.

## Project layout (short)

Business logic lives in **`lib/`**. **`app/`** and **`components/`** appear when the Next.js shell is added (M09). Integration tests live under **`tests/integration/`**. Details: **Project layout** in [MILESTONES.md](./MILESTONES.md).
