-- M05: Empty pending_refunds table for refunds a person still has to review.
-- Column names match lib/types.ts (account_id, charge_id, invoice_id, amount, charge_date, status, reason, started_at). Customer name and plan stay on accounts. Refund rules stay in TypeScript, not SQL. This file does not insert any rows.

create table public.pending_refunds (
  id bigint generated always as identity primary key,
  account_id text not null references public.accounts (id),
  charge_id text not null references public.charges (charge_id),
  invoice_id text not null,
  amount integer not null,
  charge_date date not null,
  status text not null default 'pending',
  reason text not null,
  started_at timestamptz not null,
  constraint pending_refunds_status_check check (status in ('pending', 'reviewed'))
);

create index pending_refunds_account_id_idx on public.pending_refunds (account_id);

create index pending_refunds_charge_id_idx on public.pending_refunds (charge_id);

-- Two rows with status pending cannot share the same account and charge. A reviewed row does not count.
create unique index pending_refunds_one_pending_per_charge_idx
  on public.pending_refunds (account_id, charge_id)
  where status = 'pending';

-- No policies yet, so the Data API cannot read or write this table. Direct Postgres still can.
alter table public.pending_refunds enable row level security;
