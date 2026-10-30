-- M17: Store Northline policy pages as passages you can point at.
-- Each row is one heading section from the policy-desk markdown (refunds.md, billing.md, and the other policy files).
-- document_id is the page (refunds). chunk_id is that section. source_title is the page title. passage is the section text, word for word.
-- No embeddings. Refund eligibility stays in TypeScript, not in these rows.

create table public.policy_chunks (
  document_id text not null,
  chunk_id text not null,
  source_title text not null,
  passage text not null,
  primary key (document_id, chunk_id)
);

-- No policies yet, so the Data API cannot read or write this table. Direct Postgres still can.
alter table public.policy_chunks enable row level security;

-- If a primary key is already present, that row is left as it is.
insert into public.policy_chunks (document_id, chunk_id, source_title, passage)
values
  ('auth-403-runbook', 'auth-403-runbook-intro', 'Widespread 403 after a deploy', $passage$# Widespread 403 after a deploy

Use this page when many users start getting HTTP 403 immediately after a release. A single user who cannot sign in is not this incident.$passage$),
  ('auth-403-runbook', 'auth-403-runbook-first-check', 'Widespread 403 after a deploy', $passage$## First check

Confirm the auth service version matches the version named in that release's notes. Then confirm whether API tokens were rotated in the same deploy. Those two checks come before any customer is told to reset a password.$passage$),
  ('auth-403-runbook', 'auth-403-runbook-second-check', 'Widespread 403 after a deploy', $passage$## Second check

If the version matches and tokens were not rotated, check clock skew between the auth service and the app servers. A skew over 60 seconds makes valid tokens look expired, and the client shows that as a 403.$passage$),
  ('auth-403-runbook', 'auth-403-runbook-what-to-tell-the-customer', 'Widespread 403 after a deploy', $passage$## What to tell the customer

Tell them we are investigating a release issue and we will update them. Do not ask every affected user to reset their password. Password resets do not fix a bad auth deploy.$passage$),
  ('billing', 'billing-invoices', 'Billing', $passage$## Invoices

Subscription invoices are issued on the 1st of each month. The invoice email is the billing contact on the account, not the person who filed the ticket, unless they are the same.$passage$),
  ('billing', 'billing-failed-payments', 'Billing', $passage$## Failed payments

A failed payment has a 7-day grace period. During those 7 days the product keeps working and billing emails the customer. After day 7 the account becomes read-only. After day 14 of non-payment the account is suspended. An agent tells the customer those two dates. An agent does not extend them.$passage$),
  ('billing', 'billing-double-charges', 'Billing', $passage$## Double charges

If two successful charges exist for the same invoice, refund the duplicate to the original payment method. Do not ask the customer to raise a bank dispute. Note the invoice id and both charge ids on the ticket.$passage$),
  ('escalation', 'escalation-engineering', 'When to escalate', $passage$## Engineering

Escalate to engineering only when one of these is true:

- More than one customer is affected by an outage.
- Data loss is suspected.
- The bug is reproduced on the current version after the matching runbook steps have been done.$passage$),
  ('escalation', 'escalation-stay-on-the-front-line', 'When to escalate', $passage$## Stay on the front line

Do not escalate how-to questions, a single user who cannot sign in, or a billing question. Those stay with support. Billing exceptions go to a billing lead, not to engineering.$passage$),
  ('escalation', 'escalation-what-the-ticket-needs', 'When to escalate', $passage$## What the ticket needs

An escalation includes the customer id, the time the problem started, and what was already checked. Engineering sends back a note the agent can quote. The agent does not invent a cause while waiting.$passage$),
  ('plans-and-sla', 'plans-and-sla-starter', 'Plans and uptime', $passage$## Starter

Starter is £49 per month. The uptime target is 99.9% in a calendar month. Support is email on business days, 09:00–17:30 UK time. Starter does not include a named contact.$passage$),
  ('plans-and-sla', 'plans-and-sla-growth', 'Plans and uptime', $passage$## Growth

Growth is £149 per month. The uptime target is 99.9% in a calendar month. Support is email and chat on business days, 09:00–17:30 UK time.$passage$),
  ('plans-and-sla', 'plans-and-sla-scale', 'Plans and uptime', $passage$## Scale

Scale is £499 per month. The uptime target is 99.95% in a calendar month. Support is email and chat, 08:00–20:00 UK time on business days, plus a named contact. No Northline plan includes a 99.99% uptime target. Do not promise 99.99% on any plan.$passage$),
  ('plans-and-sla', 'plans-and-sla-service-credits', 'Plans and uptime', $passage$## Service credits

If a month misses the target for that customer's plan, they can request a service credit of 10% of that month's fee. The request must arrive within 30 days of the month ending. Credits are not applied automatically.$passage$),
  ('refunds', 'refunds-intro', 'Refunds', $passage$# Refunds

Northline refunds are decided from this page. Agents quote this page. They do not offer a refund this page does not allow.$passage$),
  ('refunds', 'refunds-annual-plans', 'Refunds', $passage$## Annual plans

An annual plan can be refunded in full when the request arrives within 30 days of the charge. The charge is either the first purchase or a renewal. After day 30 the annual charge is not refunded. The customer can still turn off auto-renew so the next year is not billed.$passage$),
  ('refunds', 'refunds-monthly-plans', 'Refunds', $passage$## Monthly plans

A monthly charge can be refunded in full when the request arrives within 14 days of that charge. After day 14 that charge is not refunded. Cancelling stops the next month. It does not return the current month.$passage$),
  ('refunds', 'refunds-how-the-money-is-returned', 'Refunds', $passage$## How the money is returned

Approved refunds go back to the original payment method. They appear within 10 business days. Agents cannot approve an exception. A billing lead can approve an exception, and the ticket must record their name.$passage$)
on conflict (document_id, chunk_id) do nothing;
