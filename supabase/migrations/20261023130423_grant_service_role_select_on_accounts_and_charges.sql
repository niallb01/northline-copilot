-- M06: Let the server read accounts and charges with the service-role key.
-- These tables had no SELECT grant for service_role, so the Data API denied the lookup.
-- anon and authenticated are not granted SELECT. This does not write pending refunds.

grant select on table public.accounts to service_role;
grant select on table public.charges to service_role;
