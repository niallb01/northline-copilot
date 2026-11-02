-- M22: One row per chat turn when OpenAI returns token usage.
-- Stores the prompt, completion, and total counts from that response.
-- No message text, API key, or secret columns. This file does not insert any rows.

create table public.chat_token_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  prompt_tokens integer not null,
  completion_tokens integer not null,
  total_tokens integer not null,
  constraint chat_token_usage_prompt_tokens_non_negative check (prompt_tokens >= 0),
  constraint chat_token_usage_completion_tokens_non_negative check (completion_tokens >= 0),
  constraint chat_token_usage_total_tokens_non_negative check (total_tokens >= 0)
);

create index chat_token_usage_created_at_idx on public.chat_token_usage (created_at);

-- No policies, so the Data API cannot read or write this table. Direct Postgres still can.
alter table public.chat_token_usage enable row level security;
