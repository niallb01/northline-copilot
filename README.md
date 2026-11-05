# Northline Copilot

A demo billing desk for a fictional SaaS company. A support rep asks in plain English about a customer, their charges, a refund, or a stored policy section. The model only chooses a lookup. The answer comes from the database and from refund rules in code. A person has to confirm before anything is queued. Nothing pays out.

All customer, charge, and policy data is synthetic.

**Live app:** https://northline-copilot.vercel.app  
Password: `northline-demo`

## Try it

1. Sign in and click **Tom Ellis** under Demo customers.
2. Ask: `Tom Ellis wants a refund on his September charge — are we allowed?`
3. Ask: `What's the monthly plan refund window?`

Tom’s £49 charge from 11 Sept 2026 is past the 14-day window, so the reply is a rejection and Confirm stays empty. The citations panel quotes the stored monthly paragraph. Use a customer name or an NL number. You do not need internal ids.

![Chat rejects Tom Ellis’s September charge. Confirm is not offered.](docs/screenshots/workspace-top.png)

![Tom’s £49 charge, an empty confirm panel, Priya already waiting, and the monthly policy citation.](docs/screenshots/workspace-citations.png)

## What a question can do

- Look up one of the three customers, or list their charges.
- Quote a stored policy section. A topic that is not stored is refused.
- Check whether one charge can be refunded. The check writes nothing.
- Read who already has a refund waiting.

Confirm appears only after an eligible preview. It posts to `POST /api/refunds/confirm` when the signed session cookie and the proposal cookie match. That inserts a pending row for a person to review. Chat cannot queue a refund by itself.

Annual charges: 30 days. Monthly charges: 14 days. A later successful charge on the same invoice can still be queued. Tests pin the calendar to **2026-10-22**. The live app uses today’s date. Priya’s annual charge is dated 2026-10-11, so that window closes after 2026-11-10.

## Demo customers

| Customer | Account | Story |
| --- | --- | --- |
| Priya Shah | NL-1048291 | Annual, £1,788 on 11 Oct 2026. Eligible inside 30 days. |
| Tom Ellis | NL-1048292 | Monthly, £49 on 11 Sept 2026. Past 14 days. |
| Amina Okonkwo | NL-1048293 | Two £149 charges on one invoice. The duplicate can be queued. |

## Local

```bash
npm install
cp .env.example .env   # same server variables as production
npm run dev            # http://localhost:3000
npm test
```

`mcp/server.js` is a local stdio server with the same lookups. It does not use the website cookie. A refund from MCP still needs the human confirm form. Point Cursor at it from `.cursor/mcp.json`.

Build history: [MILESTONES.md](./MILESTONES.md).
