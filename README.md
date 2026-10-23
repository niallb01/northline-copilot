# northline-copilot

Support agents at Northline (a fictional B2B SaaS company) investigate billing disputes. This app will help an agent look up an account, read the refund policy, and queue a refund for a person to review. It does not pay anyone. All customer data is synthetic.

**Build plan:** **[MILESTONES.md](./MILESTONES.md)** — micro-steps M01–M26, with letter suffixes where a step was too big (M10b, M14a–c, M16a–c, M18a–b). One step per session; no skipping. Folder layout and where tests live are in **Project layout** in that file.

**Progress:** **M01–M03 done** → next is **M04** (seed the three canonical accounts).

## Local Supabase (M02)

Config lives in `supabase/config.toml`. Hosted project: link with `supabase link --project-ref zszfwicuvbsqtayzaelo`. M03 added empty `accounts` and `charges` tables via `supabase/migrations/`.

```bash
supabase migration list --linked
supabase db push    # when a new migration file is ready
```

Optional local stack: `supabase start` / `supabase stop` (requires Docker). This repo uses the linked cloud project for day-to-day schema work.

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
