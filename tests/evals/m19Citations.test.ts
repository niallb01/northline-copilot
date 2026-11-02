/**
 * M19 checkpoint. Checks the similarity cutoff on questions the policy files
 * support and questions they do not, then three chat cases: a refund-window
 * question cites the refunds passage the tool returned, an unsupported topic
 * is refused with no passage, and a refund in that conversation stays a
 * preview. This file does not confirm a refund or send money.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { completeChatTurn, type ChatTurn } from "../../lib/chat";
import { POLICY_MISS_MESSAGE, searchPolicy } from "../../lib/policy";
import { acceptPolicyQuote } from "../../lib/policyCitations";
import { closePool, withClient } from "../../lib/postgres";

const supported: Array<{ query: string; documentId: string; chunkId: string }> = [
  { query: "annual refund window", documentId: "refunds", chunkId: "refunds-annual-plans" },
  { query: "monthly plan refund window", documentId: "refunds", chunkId: "refunds-monthly-plans" },
  { query: "failed payment grace period", documentId: "billing", chunkId: "billing-failed-payments" },
  { query: "Scale plan uptime target", documentId: "plans-and-sla", chunkId: "plans-and-sla-scale" },
  { query: "when to escalate to engineering", documentId: "escalation", chunkId: "escalation-engineering" },
];

const unsupported = ["crypto refund", "office snack policy", "parental leave policy"];

type RowCounts = { total: number; pending: number };

describe("M19 policy citations", { concurrency: 1, timeout: 180_000 }, () => {
  after(async () => {
    await closePool();
  });

  it("keeps a passage for known-supported questions and none for known-unsupported ones", async () => {
    for (const question of supported) {
      const result = await searchPolicy(question.query);
      const hit = result.passages.some(
        (passage) => passage.documentId === question.documentId && passage.chunkId === question.chunkId,
      );
      console.log(
        `${question.query} → ${result.passages.map((passage) => `${passage.documentId}/${passage.chunkId}`).join(", ") || "(none)"}`,
      );
      assert.equal(result.message, null, question.query);
      assert.equal(hit, true, `${question.query} did not return ${question.documentId}/${question.chunkId}`);
    }

    for (const query of unsupported) {
      const result = await searchPolicy(query);
      console.log(`${query} → passages ${result.passages.length}, message ${result.message ?? "(none)"}`);
      assert.deepEqual(result.passages, [], query);
      assert.equal(result.message, POLICY_MISS_MESSAGE, query);
    }
  });

  it("cites the refund window, refuses an unsupported topic, and does not queue a refund", async () => {
    const before = await counts();

    const windowQuestion = "What is the annual plan refund window?";
    const window = await completeChatTurn(windowQuestion, []);
    assert.equal(window.ok, true);
    if (!window.ok) return;

    const annual = window.policyPassages.find(
      (passage) => passage.documentId === "refunds" && passage.chunkId === "refunds-annual-plans",
    );
    const citation = window.citations.find(
      (item) => item.documentId === "refunds" && item.chunkId === "refunds-annual-plans",
    );
    console.log("refund window reply:", window.reply);
    console.log("refund window passages:", window.policyPassages.map((passage) => passage.chunkId));
    console.log("refund window citations:", window.citations);
    assert.equal(window.toolCalls.some((call) => call.name === "search_policy"), true);
    assert.ok(annual, "search_policy did not return refunds/refunds-annual-plans");
    assert.ok(citation, "no accepted citation named refunds/refunds-annual-plans");
    assert.match(citation.quote, /30/);
    assert.equal(
      acceptPolicyQuote(
        citation,
        [{ documentId: annual.documentId, chunkId: annual.chunkId, passage: annual.text }],
      ),
      true,
    );
    assert.equal(annual.text.includes(citation.quote) || collapse(annual.text).includes(collapse(citation.quote)), true);
    assert.equal(window.proposal, null);

    const unsupportedQuestion = "What is the crypto refund rule?";
    const missed = await completeChatTurn(unsupportedQuestion, []);
    assert.equal(missed.ok, true);
    if (!missed.ok) return;
    console.log("unsupported reply:", missed.reply);
    console.log("unsupported passages:", missed.policyPassages.length);
    assert.equal(missed.toolCalls.some((call) => call.name === "search_policy"), true);
    assert.deepEqual(missed.policyPassages, []);
    assert.deepEqual(missed.citations, []);
    assert.equal(missed.reply, "The stored policy does not cover that topic.");
    assert.equal(/bitcoin|dogecoin|one day|allowed/i.test(missed.reply), false);

    const history: ChatTurn[] = [
      { role: "user", content: windowQuestion },
      { role: "assistant", content: window.reply },
    ];
    const preview = await completeChatTurn(
      "Would a refund of charge ch_annual_1 on account acct-annual-ok be allowed?",
      history,
    );
    const after = await counts();
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    console.log("preview reply:", preview.reply);
    console.log("preview tools:", preview.toolCalls.map((call) => call.name));
    console.log("preview proposal:", preview.proposal);
    console.log(`pending_refunds ${before.total} total / ${before.pending} pending → ${after.total} / ${after.pending}`);
    assert.deepEqual(after, before);
    assert.equal(preview.toolCalls.some((call) => call.name === "preview_refund"), true);
    assert.equal(preview.toolCalls.some((call) => call.name === "request_refund"), false);
    assert.equal(preview.toolCalls.some((call) => call.name === "search_policy"), false);
    const alreadyPending = await pendingFor("ch_annual_1");
    if (alreadyPending === 0) {
      assert.deepEqual(preview.proposal, {
        accountId: "acct-annual-ok",
        chargeId: "ch_annual_1",
        action: "request_refund",
      });
    } else {
      assert.equal(preview.proposal, null);
    }
  });
});

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function counts(): Promise<RowCounts> {
  return withClient(async (client) => {
    const result = await client.query<RowCounts>(
      `select
         count(*)::int as total,
         count(*) filter (where status = 'pending')::int as pending
       from public.pending_refunds`,
    );
    const row = result.rows[0];
    if (!row || typeof row.total !== "number" || typeof row.pending !== "number") {
      throw new Error("Pending count from the database was not a number.");
    }
    return row;
  });
}

async function pendingFor(chargeId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ n: number }>(
      `select count(*)::int as n
       from public.pending_refunds
       where charge_id = $1 and status = 'pending'`,
      [chargeId],
    );
    return result.rows[0]?.n ?? 0;
  });
}
