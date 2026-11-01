-- M18a: Enable pgvector and store one embedding per policy passage.
-- The column is filled from the stored passage text (OpenAI text-embedding-3-small, 1536 dimensions).
-- Search stays in lib/policy.ts. There is no similarity cutoff here, and these rows do not decide refunds.

create extension if not exists vector with schema extensions;

alter table public.policy_chunks
  add column embedding extensions.vector(1536);
