-- Operator-facing account numbers for the three canonical customers.
-- System ids (acct-annual-ok, etc.) stay the primary key for tools and tests.

alter table public.accounts
  add column account_number text;

update public.accounts
set account_number = case id
  when 'acct-annual-ok' then 'NL-1048291'
  when 'acct-monthly-late' then 'NL-1048292'
  when 'acct-double' then 'NL-1048293'
end
where account_number is null;

alter table public.accounts
  alter column account_number set not null;

create unique index accounts_account_number_key on public.accounts (account_number);
