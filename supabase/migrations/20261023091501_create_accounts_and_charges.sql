-- M03: Empty accounts and charges tables for Northline demo data.
-- Column names match lib/types.ts (customer_name, charge_id, etc.). Refund rules stay in TypeScript, not SQL.

create table public.accounts (
  id text primary key,
  plan text not null,
  customer_name text not null,
  constraint accounts_plan_check check (plan in ('annual', 'monthly'))
);

create table public.charges (
  charge_id text primary key,
  account_id text not null references public.accounts (id),
  invoice_id text not null,
  amount integer not null,
  date date not null,
  status text not null,
  constraint charges_status_check check (status in ('succeeded', 'failed', 'refunded'))
);

create index charges_account_id_idx on public.charges (account_id);
