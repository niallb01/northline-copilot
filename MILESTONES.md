# Northline Copilot — incremental build

**Repo:** `northline-copilot`

## How we work (read this every session)

1. **One micro-step per session.** A letter suffix (`M14a`) is still one session. Do not do `M14b` in the same sitting.
2. **Do not skip.** If M08 is not done, we do not start the chat UI.
3. **Concept first.** Each step adds one idea you can explain in one sentence.
4. **Shared brain.** Business logic stays in `lib/`. Chat and MCP call `lib/` later. Refund rules are not copied into SQL, the UI, or the system prompt.
5. **Safety line.** Nothing in this project pays money. `pending` means a person still has to review it. Reject means no row is saved.
6. **The database holds the line on writes.** A pending row is inserted inside one Postgres transaction on a direct connection. A unique index stops two pending rows for the same charge. The TypeScript rules still decide eligibility. They are not copied into SQL.
7. **A button is not authorisation.** From M10b, protected routes check an HttpOnly session cookie set by a server-side demo login. Browser JavaScript never sees the demo password or the session value. The model cannot mint a refund confirmation. MCP is a local process; its write step asks the human to confirm that exact charge.
8. **Dev wire logs (browser ↔ route).** When a milestone connects UI to an `app/api/…` handler, add short logs gated on `NODE_ENV === "development"`: in the client component, log the method/URL and JSON body before `fetch`, then log response status and body after; in the route handler, log what was received and what is returned (or passed to `lib/`). Browser DevTools shows the client lines; the `next dev` terminal shows the server line. That makes it easy to see what was built and what receives it. Follow the M14a chat and M11 `get_account` patterns unless the step says otherwise.

**What we’re building:** One agent workspace (chat left, context right). Synthetic Northline data only. The model investigates. Code decides refunds. A human confirms before anything is queued.

**Stack (fixed):** Next.js + TypeScript route handlers, Supabase Postgres, pgvector for policy retrieval, OpenAI from the server only, one shared tool layer, MCP stdio, Vercel + Supabase. No LangGraph, CrewAI, n8n, or a second backend.

---

## Project layout (create folders when a milestone needs them)

Do not scaffold empty trees ahead of time. Each micro-step adds only the paths it lists.

**Target shape** (most of this appears from M03 onward):

```text
app/                      # Next.js routes, layouts, API handlers (thin — call lib/)
components/               # UI: chat, context panels, login form (M09+)
lib/                      # Business logic: rules, tools, DB services, RAG (shared by web + MCP)
  refundRules.ts
  refundRules.test.ts     # unit tests live next to the module they test
mcp/                      # Stdio MCP server entry (M23+)
supabase/                 # config.toml, migrations/, seed (M02+)
tests/
  integration/            # DB + transaction tests (M08+)
  evals/                  # Behaviour cases and runner (M25; small checks in M08/M16a/M19)
```

| Area | Rule |
| --- | --- |
| **`lib/`** | Refund rules, tool dispatcher, Supabase read/write services, policy search. Chat routes and MCP handlers call in; they do not duplicate rules. |
| **`app/`** | HTTP only: pages, layouts, route handlers. Handlers validate session (M10b), then delegate to `lib/`. |
| **`components/`** | Presentation. No refund windows or policy text hard-coded as source of truth. |
| **Unit tests** | Colocate as `*.test.ts` beside the file under `lib/` (same pattern for `*.test.tsx` beside a component if we add component tests). |
| **Integration tests** | `tests/integration/` — Postgres, M07 transaction, concurrency (M08). Not mirrored under every `lib/` file. |
| **Evals** | `tests/evals/` — prompts, expected tool outcomes, citation checks (M25 grows from M08/M16a/M19 checkpoints). |
| **State** | No top-level `state/` folder at first. Server truth is Postgres; session/proposal is HttpOnly cookie (M10b/M16); workspace UI uses local React state or URL params until the same logic is reused in two places. |
| **File headers** | Each new code file under `lib/`, `app/`, `components/`, and `mcp/` starts with one plain-English paragraph (block comment) saying what the file does and what it deliberately does *not* do. |

**When folders first appear**

| Folder | First milestone |
| --- | --- |
| `lib/` | M01 (exists) |
| `supabase/` | M02 (exists) |
| `supabase/migrations/` | M03 |
| `tests/integration/` | M08 |
| `app/` | M09 |
| `components/` | M10 (M10b adds the login form as needed) |
| `tests/evals/` | M16a checkpoint file, expanded in M25 |
| `mcp/` | M23 |

---

## Phases (map only — you execute micro-steps)

| Phase | Topic | Micro-steps |
| --- | --- | --- |
| A | Refund rules in pure code | M01 ✅ |
| B | Postgres stores accounts and pending | M02–M08 |
| C | Workspace UI (no model yet) | M09–M12 (login is M10b, before any data route) |
| D | Agent tool loop, one tool at a time | M13–M16b |
| D2 | Staging deploy of that slice | M16c |
| E | Policy RAG (embed → cite → refuse) | M17–M19 |
| F | Audit and token counts | M20–M22 |
| G | MCP (same tools as the app) | M23–M24 |
| H | Full eval scorecard | M25 |
| I | Portfolio deploy and README | M26 |

Small eval checkpoints ship inside M08, M16a, and M19. M25 is the full set, not the first time we check behaviour.

---

## Progress

| Step | Status |
| --- | --- |
| M01 | **Done** |
| M02 | **Done** |
| M03 | **Done** |
| M04 | **Done** |
| M05 | **Done** |
| M06 | **Done** |
| M07 | **Done** |
| M08 | **Done** |
| M09 | **Done** |
| M10 | **Done** |
| M10b | **Done** |
| M11 | **Done** |
| M12 | **Done** |
| M13 | **Done** |
| M14a | **Done** |
| M14b | **Done** |
| M14b2 | **Done** |
| M14c | **Done** |
| M15–M26 | Not started |

---

## Phase A — Refund rules (no database, no UI, no model)

### M01 — Pure `requestRefund` + unit tests ✅

**Concept:** Refund eligibility is a function, not an AI opinion.

**What exists:** `lib/types.ts`, `lib/seed.ts`, `lib/refundRules.ts`, `lib/refundRules.test.ts`

**You run:**

```bash
npm test
```

**You should understand:**

- Accept appends one pending object in memory. Reject appends nothing.
- Windows: annual ≤ 30 days, monthly ≤ 14 days, a later successful charge on the same invoice, a second request while pending is rejected.
- Tests pin “today” to **2026-10-22** so the three seed stories stay stable.

**Not in this step:** Supabase, Next.js, OpenAI, MCP.

---

## Phase B — Database holds facts; code still decides refunds

### M02 — Supabase in the repo (config only)

**Concept:** Migrations are versioned SQL. The app will read and write through Supabase later, not through JSON files.

**Adds:** `supabase/config.toml`, plus a short note of the CLI workflow (`supabase init` / link or `supabase start`).

**You run:** `supabase --version`, then `supabase init` (or confirm the CLI and project link).

**You should understand:** Postgres will be the system of record for accounts, charges, and pending refunds. Refund rules stay in `lib/refundRules.ts`.

**Not in this step:** Tables, seeds, Next.js.

**Done:** `supabase/config.toml` is in the repo. The local database is not started. No tables exist yet.

---

### M03 — Tables: `accounts` + `charges`

**Concept:** The seed records become relational rows.

**Adds:** One migration. Accounts have id, plan, customer name. Charges have charge id, account id, invoice id, amount, date, status, and a foreign key to accounts.

**You run:** Apply the migration. The table list shows `accounts` and `charges`.

**You should understand:** A charge belongs to one account. SQL does not contain refund windows.

**Not in this step:** Pending refunds, application code, seed rows.

---

### M04 — Seed the three canonical accounts

**Concept:** The same three stories as `lib/seed.ts`. Their meaning does not change.

**Adds:** Seed SQL for `acct-annual-ok`, `acct-monthly-late`, `acct-double`, and their charges.

**You run:** Seed, then `select id from accounts` returns exactly those three ids.

**You should understand:** Later checks depend on these ids and dates.

**Not in this step:** Pending table, TypeScript database client.

---

### M05 — Table: `pending_refunds` + one-pending-per-charge index

**Concept:** The database itself refuses a second pending row for the same charge.

**Adds:** Migration for pending refunds, plus a partial unique index on `(account_id, charge_id)` where status is `pending`.

**You run:** Apply the migration. Describe the index in one sentence: two pending rows for the same charge cannot both exist.

**You should understand:** This index is the invariant. Application code still has to insert inside a transaction (M07) and treat a unique violation as “already pending.”

**Not in this step:** Wiring `requestRefund` to Postgres.

---

### M06 — Read path: `getAccount` + `listCharges` in `lib/` ✅

**Concept:** A lookup is a function over the database. It does not change pending refunds.

**Adds:** A server-side Supabase client and read functions that return the same shapes as `lib/types.ts`.

**You run:** A small script or test fetches `acct-double` and prints both charge ids.

**You should understand:** Reads have no refund side effects. The service-role key, when we add it, stays in server env only.

**Not in this step:** OpenAI, UI, the refund write path.

**Done:** `lib/supabase.ts` builds a server-only client from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. A migration grants `service_role` `SELECT` on `accounts` and `charges`. `getAccount` and `listCharges` in `lib/accounts.ts` return the shapes in `lib/types.ts`. `npm run print:acct-double` prints `ch_double_1` and `ch_double_dup`. No pending row is written.

---

### M07 — Write path: one transaction, then the existing rules

**Concept:** Eligibility and the insert share one database transaction. The rules function stays in TypeScript.

**How the transaction runs (decided before this step):** The Supabase JavaScript client can call a single RPC. It cannot keep a multi-statement transaction open while Node code runs. A PL/pgSQL function that reimplemented the windows would be a second copy of the rules, so we are not doing that.

M07 uses a direct Postgres connection from the server (`DATABASE_URL`, session mode, port 5432). One connection does all of this, then commits or rolls back:

1. `BEGIN`.
2. Lock the charge row (`SELECT … FOR UPDATE`) so a second request waits.
3. Load the account, charges, and current pending rows.
4. Call `requestRefund` from `lib/refundRules.ts`.
5. `INSERT` one pending row only when the result is accept.
6. `COMMIT`.
7. If the unique index rejects the insert, return “already pending” and leave the table unchanged.

Ordinary reads can keep using the Supabase client. This write path does not.

**You run:** A script, one call at a time.

- `acct-annual-ok` / `ch_annual_1` → one pending row.
- `acct-monthly-late` / `ch_monthly_1` → rejected, row count unchanged.
- `acct-double` / `ch_double_dup` → one pending row.
- The same annual charge again → rejected, still one row.

**You should understand:** Two requests cannot both pass the check and both insert. The loser waits on the lock, or hits the unique index, and both end as a clean rejection with a single row.

**Not in this step:** Chat, the confirm button, the audit log.

**Done:** `lib/postgres.ts` checks out one session-mode connection from `DATABASE_URL` (port 5432). `queueRefund` in `lib/refunds.ts` locks the charge, loads the account, charges, and pending rows, calls `requestRefund`, and inserts one pending row only on accept. A unique-index violation comes back as already pending. `npm run queue:refund-cases` runs the four cases on 2026-10-22. No chat and no Next.js.

---

### M08 — Persistence checks, including a concurrent double submit

**Concept:** M01 proved the rules. This step proves the database keeps them, including two overlapping requests.

**Adds:** Integration tests against local Supabase (or a dedicated test database).

**Checkpoint cases:**

- Annual in window → one pending row.
- Monthly too old → reject, no row.
- Duplicate charge → one pending row.
- Unknown account → clear error, no row.
- Second request while pending → reject, still one row.
- Two overlapping requests for the same eligible charge → exactly one pending row, the other call rejected.

**You run:** `npm test` (or `npm run test:integration` if we split scripts).

**You should understand:** A failure here is a persistence bug. The rule function already passed in M01.

**Not in this step:** Next.js pages. This checkpoint is not the full eval suite (that is M25).

**Done:** `tests/integration/queueRefund.test.ts` calls `queueRefund` on Postgres through `DATABASE_URL` (session mode, port 5432) with today fixed at 2026-10-22. The cases are annual in window, monthly too old, the duplicate charge, an unknown account, a second request while pending, and two overlapping requests for the same eligible charge. Each run deletes pending rows for the charges it touches, then checks the table. `npm run test:integration` runs them. `npm test` still runs only the in-memory rule tests. No Next.js.

---

## Phase C — Workspace shell (still no model)

### M09 — Next.js App Router skeleton ✅

**Concept:** Routes live under `app/`. This repo is now a web app plus `lib/`.

**Adds:** Next.js + TypeScript, `npm run dev`, a plain home page.

**You run:** The home page loads locally.

**Not in this step:** Chat, OpenAI, Vercel.

**Done:** Next.js (App Router) and React are installed. `app/layout.tsx` is the document shell and `app/page.tsx` is a plain home page. `npm run dev` serves that page locally. No chat, no OpenAI, and no route that reads or writes refunds. Business logic stays in `lib/`.

---

### M10 — Two-column workspace layout ✅

**Concept:** One product surface. Chat on the left. Context on the right.

**Adds:** A workspace page with empty labeled panels: Chat, Account, Charges, Policy citations, Pending queue.

**You run:** Open the workspace and see those labels.

**Not in this step:** Live data, a model, login.

**Done:** `/workspace` is the operator surface. Chat is the left column. Account, Charges, Policy citations, and Pending queue are empty labeled panels on the right. `app/workspace/page.tsx` only renders `components/Workspace.tsx`. The home page links there. No live data, no model, and no login.

---

### M10b — Demo login and an HttpOnly session ✅

**Concept:** The server decides who is signed in. The browser never handles the demo password as a token.

**Adds:** A login form that POSTs the password to a route. The route compares it with `DEMO_PASSWORD` in server env. On a match it sets a session cookie: `HttpOnly`, `SameSite=Lax`, `Secure` in production, signed with `SESSION_SECRET`. JavaScript on the page cannot read the cookie. Protected routes check that cookie and return 401 when it is missing or invalid. There is no `Authorization` header carrying the demo password.

**You run:** Open a protected placeholder route with no cookie and get 401. Log in through the form and the same route returns 200. The cookie is absent from `document.cookie`.

**You should understand:** This is a single shared demo login, not Supabase Auth and not a user table. M11 and M12 come after this, so account reads and “mark reviewed” both require the session.

**Not in this step:** Account data, refunds.

**Done:** `/login` posts the demo password to `POST /api/login`. The route compares it with `DEMO_PASSWORD` and, on a match, sets an HttpOnly `northline_session` cookie (`SameSite=Lax`, `Secure` in production) signed with `SESSION_SECRET`, then sends the operator to `/workspace`. That page and the data routes check the same cookie; without it, `/workspace` redirects to `/login`. `GET /api/protected` returns 401 without a valid cookie and 200 with one. Page JavaScript cannot read the cookie. No account reads and no refund writes. This is one shared demo login, not Supabase Auth.

---

### M11 — Context panel reads an account through your API

**Concept:** The browser calls your route. The route calls `lib/`. The browser never holds the service-role key.

**Adds:** A route handler and a panel that shows one account and its charges for an id you type or select. The route rejects requests that do not have the M10b session cookie.

**You run:** Log in, enter `acct-annual-ok`, and see Priya Shah and one charge. Call the same route without the cookie and get 401, with no account JSON.

**You should understand:** The panel displays facts. It does not decide refunds.

**Not in this step:** Pending queue, mark reviewed, chat, tools, OpenAI, MCP.

**Done:** `GET /api/accounts/[accountId]` checks the M10b session cookie. Without a valid cookie it returns 401 and no account JSON. With a valid cookie it calls `getAccount` and returns that account and its charges. On `/workspace`, the operator types or selects an id. The Account and Charges panels show those facts (`acct-annual-ok` shows Priya Shah and one charge). The panels do not decide refunds or queue pending rows. Chat, policy citations, and the pending queue stay empty.

---

### M12 — Pending queue, and “mark reviewed” with no payout

**Concept:** The agent can see what is waiting. Marking a row reviewed does not send money.

**Adds:** The pending list on the workspace. A button sets that row’s status to reviewed. The route requires the M10b session cookie.

**You run:** Log in. A pending row created in M07 shows in the panel. After the button, it is reviewed and no payment record exists. The same request without the cookie changes nothing.

**Not in this step:** A model, MCP.

**Done:** `GET /api/pending-refunds` checks the M10b session cookie. Without a valid cookie it returns 401 and no queue JSON. With a valid cookie it calls `listPendingRefunds` and returns pending rows from `pending_refunds`. On `/workspace`, the Pending queue panel shows those rows. `POST /api/pending-refunds/review` checks the same cookie, then `markRefundReviewed` sets that row’s status to `reviewed`. The charge is left as it was, and no payment table is written. Without the cookie the row stays unchanged. No model and no MCP.

---

## Phase D — Chat tool loop (one concept at a time)

### M13 — Tool dispatcher on the server (no OpenAI)

**Concept:** A tool name maps to a `lib/` function. Arguments are checked. The result is JSON.

**Adds:** One dispatcher module. A unit test calls it for `get_account` and `list_charges`. If there is also an HTTP route, that route requires the M10b session cookie.

**You run:** Call `get_account` with `acct-missing`. The result is a clear not-found error, not a stack trace.

**You should understand:** The same dispatcher is what the model and MCP will call later.

**Not in this step:** A model, streaming UI.

**Done:** `dispatchTool` in `lib/tools.ts` maps a tool name to a `lib/` function, checks the arguments, and returns JSON. `get_account` calls `getAccount`. `list_charges` calls `listCharges`. A missing account (`acct-missing`) comes back as a clear not-found error, not a stack trace. Unit tests call the dispatcher for both tools. `POST /api/tools` checks the M10b session cookie. Without a valid cookie it returns 401 and does not run a tool. No model and no streaming UI.

---

### M14a — Chat panel wired to a stub reply

**Concept:** The page can send a message and show a reply before any model exists.

**Adds:** Chat UI. A server route that returns a fixed sentence and does not call OpenAI.

**You run:** Type “hello”. The transcript shows your message and the stub reply.

**Not in this step:** An API key, tools.

**Done:** The Chat panel on `/workspace` sends the operator’s message to `POST /api/chat`. That route checks the M10b session cookie. Without a valid cookie it returns 401 and no reply. With a valid cookie it returns one fixed stub sentence and does not call OpenAI, read an API key, or run a tool. The transcript shows the message and that stub reply. No model and no tool loop.

---

### M14b — One real model reply, no tools

**Concept:** The server calls OpenAI. The key stays in server env. The model cannot call tools yet.

**Adds:** The route uses the chat completion API and returns the model’s text. Record token usage on the server if the response includes it (display comes later, in M22).

**You run:** Ask a general question. You get a model sentence. The browser network tab does not contain the API key.

**Not in this step:** `get_account`, refunds, multi-turn history on the wire (M14b2).

**Done:** `POST /api/chat` still checks the M10b session cookie. With a valid cookie it calls the OpenAI chat completions API from `lib/chat.ts` and returns the model's text as `{ reply }`. `OPENAI_API_KEY` stays in server env and is not sent to the browser. If the provider response includes usage, the route logs prompt, completion, and total tokens. The request registers no tools. No account lookup and no refund. Each request sends only the latest user message; prior transcript bubbles are UI-only until M14b2.

---

### M14b2 — Prior turns on the wire

**Concept:** The transcript is not just decoration. Each new message is answered in the context of earlier user and assistant turns in that session.

**Adds:** `ChatPanel` sends the prior transcript (user and assistant roles) with the new message. `POST /api/chat` validates and caps that history, then `lib/chat.ts` passes the full `messages` array to OpenAI (system prompt still set on the server only). Still one `{ reply }` back; still no tools. No server-side thread store yet—the browser holds the transcript in React state, same as today.

**You run:** Ask the capital of Mongolia, then “Uzbekistan?”, then “capital city”. The model uses the thread and names Tashkent without you repeating the country every time.

**Not in this step:** Tools, persisted chat sessions in Postgres, streaming.

**Done:** The Chat panel sends the new message plus earlier user and assistant turns from React state to `POST /api/chat`. The route checks the M10b session cookie, rejects anything that is not user or assistant text, and keeps the newest 20 turns. `lib/chat.ts` places that history after the server-only system prompt and returns one `{ reply }`. The system prompt tells the model a short follow-up refers to those earlier turns. Mongolia, then “Uzbekistan?”, then “capital city” came back as Tashkent. No tools, no Postgres thread store, and no streaming.

---

### M14c — `get_account` inside the tool loop

**Concept:** The model may request a tool. Your server runs it and sends the result back. Then the model writes the final sentence.

**Adds:** `get_account` registered on the loop from M14b2. Print or show the tool name and arguments in the chat transcript.

**You run:** “Look up acct-monthly-late.” The transcript shows a `get_account` call and a short account summary.

**Not in this step:** `list_charges`, refunds, policy search.

**Done:** `POST /api/chat` still checks the M10b session cookie and still sends prior user and assistant turns. The completion now offers only `get_account`. If the model requests that tool, the server runs it through `dispatchTool`, sends the result back, and the model writes the final sentence. The transcript shows the tool name and arguments, then that sentence. “Look up acct-monthly-late.” showed `get_account` with `{"account_id":"acct-monthly-late"}` and a short summary: Tom Ellis, monthly plan, account `acct-monthly-late`. `list_charges` is not on the loop. No refund is queued and no policy search runs.

---

### M15 — Add `list_charges` to the loop

**Concept:** Investigation needs the account and the charge lines. Read tools do not write pending rows.

**Adds:** `list_charges` on the same dispatcher and loop.

**You run:** Ask for charges on `acct-double`. The reply names both charge ids.

**Not in this step:** A refund proposal, policy search.

---

### M16a — The model prepares a refund proposal, and nothing is written

**Concept:** The model can ask whether a charge would be refundable. That question does not insert a row.

**Adds:** A `preview_refund` tool on the dispatcher. It runs the same eligibility rules in read-only mode and returns pending-or-rejected plus the reason. It does not call the M07 insert. The tool result has no confirmation token. When the preview is eligible, the server stores a proposal on the HttpOnly session: account id, charge id, action `request_refund`, and an expiry. The model cannot read or create that cookie.

**Checkpoint cases (pending count unchanged for every one of them):**

- Annual in window → preview says it would be pending.
- Monthly too old → preview says rejected.
- Duplicate charge → preview says it would be pending.
- Unknown account → clear error.
- A prompt that says to ignore the rules → ineligible charges are still rejected.

**You run:** Those cases. `pending_refunds` does not gain a row.

**You should understand:** There is no `request_refund` tool in the model’s tool list. The model can be talked into asking. Asking is not a write.

**Not in this step:** The confirm route, RAG, MCP.

---

### M16b — The human confirms; the server checks that exact proposal

**Concept:** A write happens only when the signed-in human confirms the proposal the server stored. The model cannot confirm for them.

**Adds:** A confirm control. It POSTs to a route that is not a model tool. The route allows the M07 service only when all of these are true:

1. The M10b session cookie is valid.
2. That session holds an unexpired, unused proposal.
3. The proposal’s account id, charge id, and action match this confirm request.

A body field such as `confirmed: true` from the model is ignored. The route then calls the shared refund service, which still applies the rules. A rejected service result inserts nothing and the UI says the refund was not started.

**You run:**

- Confirm the duplicate on `acct-double` → one pending row.
- Preview `acct-monthly-late` → no row. Confirm is not offered for a rejected preview.
- POST the confirm route with no matching session proposal → no row.
- POST with `confirmed: true` and no proposal → no row.

**You should understand:** Skipping the button cannot create a row. A forged confirm cannot create a row. M07 still decides eligibility.

**Not in this step:** Deploy, RAG, MCP.

---

### M16c — Staging deploy of this slice

**Concept:** Put the working workspace on Vercel before RAG and MCP, so env vars, serverless, and Supabase show their problems early.

**Adds:** A staging URL. Server env holds the OpenAI key, `DATABASE_URL`, the Supabase service role, `DEMO_PASSWORD`, and `SESSION_SECRET`. A short README note lists the URL and those names only.

**You run:** Open the staging URL, log in through the form, look up `acct-monthly-late`, and preview a refund. The preview is rejected and no new pending row appears.

**You should understand:** This is a connectivity checkpoint, not the portfolio write-up. M26 is the polished release.

**Not in this step:** Policy search, MCP, screenshots, the full eval list.

---

## Phase E — Policy RAG (answers from stored text)

### M17 — Store policy chunks in Postgres

**Concept:** The retrieval corpus is the Northline policy markdown, split into rows you can point at.

**Adds:** A `policy_chunks` table with document id, chunk id, source title, and the exact passage text. Seed from the policy-desk pages (`refunds.md`, `billing.md`, and the other policy files). No embeddings yet.

**You run:** Row count is greater than zero. One refunds passage is visible in the table, word for word.

**You should understand:** Eligibility is still the code from M01 and M07. These rows are what the model is allowed to quote.

**Not in this step:** Vectors, chat.

---

### M18a — Embedding retrieval with pgvector

**Concept:** `search_policy` returns stored passages by vector similarity, each with its document id and chunk id.

**Adds:** The pgvector extension, an embedding column, embeddings generated from the chunk text, and `search_policy` in `lib/`. The function returns only rows from `policy_chunks`. It does not write a sentence of its own.

**You run:** A script searches “annual refund window” and prints the passage plus document id and chunk id. The passage text matches the stored chunk exactly.

**You should understand:** Similarity picks candidates. It does not decide a refund.

**Not in this step:** The empty-result rule, the chat panel.

---

### M18b — No match means no policy answer

**Concept:** When nothing relevant is stored, the tool says so. It does not invent a passage.

**Adds:** A similarity cutoff in `search_policy`. Below the cutoff, the result is an empty passage list plus a clear “policy does not contain this” message. The cutoff is a starting heuristic. It does not prove relevance. M19 and M25 calibrate it against questions we know the docs support and questions we know they do not.

**You run:** Search for something the files do not cover (for example a crypto refund). The result has no passage and does not mention a made-up rule.

**Not in this step:** The model in the chat.

---

### M19 — Citations in chat, checked against retrieved text

**Concept:** A citation names a specific source passage the tool returned. Matching words from some other chunk do not count.

**Adds:** `search_policy` on the tool loop. The context panel lists each passage with its document id and chunk id. A citation is accepted only when both are true: the document id and chunk id are in that tool result, and the quoted text is a substring of that same passage. Calibrate the M18b cutoff on the known-supported and known-unsupported questions below.

**Checkpoint:**

- A refund-window question cites the refunds document id and chunk id from the tool result, and the quote is inside that passage.
- A question the files do not support ends in a refusal, with no invented passage.
- A refund in the same conversation is still only a preview until the human confirms. The model’s reading of the policy does not insert a row.

**You run:** Those three checks.

**You should understand:** “Sounds confident” is not a pass. This checkpoint is not the full suite in M25.

**Not in this step:** MCP, the audit table.

---

## Phase F — Observability

### M20 — `audit_logs` table

**Concept:** Every tool call can leave a row: tool name, arguments, outcome, and whether a pending row was created.

**Adds:** The migration only. No API keys and no raw secrets in the column list.

**You run:** The table exists and is empty.

**Not in this step:** Writing rows, token columns.

---

### M21 — Write an audit row for every tool call

**Concept:** Successes and failures are both logged. A failed `request_refund` logs the rejection and does not insert a pending row.

**Adds:** The dispatcher writes one audit row per call.

**You run:** Look up a missing account. An audit row exists, the agent sees a plain error, and the pending count is unchanged.

**Not in this step:** A billing dashboard.

---

### M22 — Token usage for each chat turn

**Concept:** When OpenAI returns usage, store the prompt, completion, and total tokens for that turn.

**Adds:** Columns or a small usage table, filled from the provider response. Show a simple total for a sample conversation in the audit view or the README.

**You run:** One chat turn. The stored total matches the usage object from that response.

**Not in this step:** A cost dashboard.

---

## Phase G — MCP (second client, same rules)

### M23 — MCP stdio server, read tools only

**Concept:** MCP is the wire. The handlers call the same `lib/` functions as the website.

**Adds:** A stdio server with `get_account` and `list_charges`. README Cursor config: command `node`, args the full path to the server file.

**You run:** Point Cursor at the server and ask for `acct-annual-ok`.

**Not in this step:** Write tools. MCP stays a local process. It does not use the website’s session cookie.

---

### M24 — MCP: `search_policy` and a human-confirmed write

**Concept:** Cursor does not get a looser refund rule, and the model cannot confirm a refund by itself.

**Adds:** `search_policy` and `preview_refund` as normal tools. A write runs only after the MCP server asks the human to confirm that exact account id and charge id (the SDK’s elicitation or user-input step). The handler ignores a confirmation field on the model’s tool arguments. Decline, or a mismatch, inserts nothing. Accept calls the same M07 service as the website.

At the start of this step, check whether the MCP SDK can ask the user that question. If it cannot, do not register a write tool. Refunds stay on the website, and the README says so.

**You run:** Ask about a refund for `acct-monthly-late`. The preview rejects it and the pending table does not gain a row. For an eligible charge, declining the human prompt also leaves the table unchanged.

**You should understand:** Two interfaces, one rule set, one transaction. A model argument is not approval.

---

## Phase H — Full scorecard

### M25 — Eval set of about 30–50 cases

**Concept:** Publish what passed, what failed, and what you did not try to defend against. Do not invent an accuracy percentage.

**Adds:** Grow the checkpoint cases from M08, M16a, and M19 into one set of about 30–50. The set includes:

- Policy question whose citation names a returned document id and chunk id, and whose quote is inside that passage.
- The M18b cutoff, checked again on known supported and unsupported questions.
- Policy question with no evidence, and a refusal.
- Annual in window → pending.
- Monthly too old → reject, no row.
- Duplicate charge → pending.
- Unknown account → clear error.
- User tries to override the rules → rules still win.
- Second request for the same pending charge → reject.
- A failed tool call does not pretend a refund started.

**You run:** The eval script. Record pass and fail in the README, plus a sample token total from one run.

**Not in this step:** A general prompt-injection detector. Document that the model can be talked into asking, and the code is what holds the line.

---

## Phase I — Portfolio release

### M26 — Production deploy and the README a stranger can follow

**Concept:** The public app and the MCP server follow the same rules.

**Adds:** Production Vercel + Supabase settings, architecture, tool list, MCP setup, limits, screenshots, the M25 pass/fail list, and a sample token total.

**Done when:** A stranger opens the deployed app, asks about `acct-monthly-late`, sees a cited policy answer and a rejected refund with no new pending row, and can point Cursor at the MCP server and hit the same rules.

---

## Session checklist

1. Open only the current micro-step (for example M02).
2. Implement only what that step lists under **Adds**.
3. If the step wires browser UI to a route handler, add the dev wire logs from **How we work** §8 (client send/reply + server received/response).
4. Run **You run**. Paste the output if it looks wrong.
5. Say **“M02 done”** before asking for the next step.

**Optional “Start M…” prompt line** (paste when you want the agent to follow §8):

> When this step adds or changes a browser → API call, include development-only `console.log`s on both sides so I can see URL, request body, and response in DevTools and the dev server terminal.

## When you’re ready

Say **“Start M15”**. M15 adds `list_charges` on the same loop. Read tools still do not write pending rows.
