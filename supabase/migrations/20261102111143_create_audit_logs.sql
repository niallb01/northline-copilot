-- M20: Empty audit_logs table. A later step can write one row per tool call.
-- A row records the tool name, the arguments, the outcome, and whether a pending row was created.
-- No API key, secret, or token columns. This file does not insert any rows.
-- The dispatcher does not write here yet.

create table public.audit_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  tool_name text not null,
  arguments jsonb not null,
  outcome jsonb not null,
  pending_row_created boolean not null,
  constraint audit_logs_tool_name_not_blank check (length(btrim(tool_name)) > 0),
  constraint audit_logs_arguments_is_object check (jsonb_typeof(arguments) = 'object'),
  constraint audit_logs_outcome_is_object check (jsonb_typeof(outcome) = 'object')
);

create index audit_logs_created_at_idx on public.audit_logs (created_at);

-- No policies yet, so the Data API cannot read or write this table. Direct Postgres still can.
alter table public.audit_logs enable row level security;
