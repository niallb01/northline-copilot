-- M04: Seed the three canonical accounts and their charges.
-- Rows match lib/seed.ts (ids, dates, amounts, statuses). If a primary key is already present, that row is left as it is. Refund rules stay in TypeScript, not SQL.

insert into public.accounts (id, plan, customer_name)
values
  ('acct-annual-ok', 'annual', 'Priya Shah'),
  ('acct-monthly-late', 'monthly', 'Tom Ellis'),
  ('acct-double', 'monthly', 'Amina Okonkwo')
on conflict (id) do nothing;

insert into public.charges (charge_id, account_id, invoice_id, amount, date, status)
values
  ('ch_annual_1', 'acct-annual-ok', 'in_annual_1', 1788, '2026-10-11', 'succeeded'),
  ('ch_monthly_1', 'acct-monthly-late', 'in_monthly_1', 49, '2026-09-11', 'succeeded'),
  ('ch_double_1', 'acct-double', 'in_double_1', 149, '2026-07-23', 'succeeded'),
  ('ch_double_dup', 'acct-double', 'in_double_1', 149, '2026-07-23', 'succeeded')
on conflict (charge_id) do nothing;
