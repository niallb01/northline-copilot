# northline-copilot

Support agents at Northline (a fictional B2B SaaS company) investigate billing disputes. This app will help an agent look up an account, read the refund policy, and queue a refund for a person to review. It does not pay anyone. All customer data is synthetic.

**Build plan:** **[MILESTONES.md](./MILESTONES.md)** — micro-steps M01–M26, with letter suffixes where a step was too big (M10b, M14a–c, M16a–c, M18a–b). One step per session; no skipping. Folder layout and where tests live are in **Project layout** in that file.

**Progress:** **M01–M06 done** → next is **M07** (one Postgres transaction that calls `requestRefund`, then inserts a pending row).

## Local Supabase (M02)

Config lives in `supabase/config.toml`. Hosted project: link with `supabase link --project-ref zszfwicuvbsqtayzaelo`. M03 added empty `accounts` and `charges` tables via `supabase/migrations/`. M04 seeded `acct-annual-ok`, `acct-monthly-late`, and `acct-double` plus their charges. M05 added an empty `pending_refunds` table. A partial unique index on `(account_id, charge_id)` where `status` is `pending` stops two pending rows for the same charge.

```bash
supabase migration list --linked
supabase db push    # when a new migration file is ready
```

Optional local stack: `supabase start` / `supabase stop` (requires Docker). This repo uses the linked cloud project for day-to-day schema work.

## M06 — read an account (done)

`lib/supabase.ts` is a server-only client. It reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the environment (copy `.env.example` to `.env`). That key bypasses row level security. It is not a publishable key, and neither name may start with `NEXT_PUBLIC_`. The migration for this step grants `service_role` `SELECT` on `accounts` and `charges` only.

`getAccount` and `listCharges` in `lib/accounts.ts` return the shapes in `lib/types.ts` (`charge_id` becomes `chargeId`, `customer_name` becomes `customerName`, `date` stays a `YYYY-MM-DD` string). They do not insert pending refunds.

```bash
npm run print:acct-double
```

That prints `ch_double_1` and `ch_double_dup` for `acct-double`.

## M01 — refund rules (done)

Only the decision exists. There is no website, database, model, or MCP server yet.

`lib/refundRules.ts` is a port of `northline-desk/refundRules.js`. The same windows:

| Situation | Result |
| --- | --- |
| Annual charge 30 days old or newer | One `pending` row |
| Monthly charge 14 days old or newer | One `pending` row |
| A later successful charge on the same invoice | One `pending` row, even if the date is old |
| Anything else | Rejected. Nothing is saved |
| A second request while that charge is already pending | Rejected. Nothing new is saved |

The three seed accounts in `lib/seed.ts` keep their original meaning. Tests pin today to **2026-10-22**.

| Account | Charge | On that day |
| --- | --- | --- |
| `acct-annual-ok` | `ch_annual_1` (2026-10-11) | Pending. 11 days old, inside 30. |
| `acct-monthly-late` | `ch_monthly_1` (2026-09-11) | Rejected. 41 days old, past 14. No row. |
| `acct-double` | `ch_double_dup` | Pending. Second success on `in_double_1`. |
| `acct-double` | `ch_double_1` | Rejected. First charge on that invoice, and it is past 14 days. |

```bash
npm test
```

The tests call `requestRefund` directly. They do not call a model.
