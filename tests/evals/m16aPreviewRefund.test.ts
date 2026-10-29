/**
 * M16a checkpoint. Each case calls preview_refund through the dispatcher on
 * the story date 2026-10-22. The preview reads accounts and pending rows. It
 * does not insert. Every case checks that public.pending_refunds has the same
 * row count afterwards, including rows already marked reviewed. This file
 * does not call queueRefund, confirm a proposal, or start Next.js.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { closePool, withClient } from "../../lib/postgres";
import { STORY_TODAY } from "../../lib/seed";
import { dispatchTool, type ToolResult } from "../../lib/tools";

const today = new Date(2026, 9, 22);
const now = new Date(`${STORY_TODAY}T12:00:00.000Z`);

type RowCounts = { total: number; pending: number };

describe("M16a preview_refund checkpoint", { concurrency: 1 }, () => {
  after(async () => {
    await closePool();
  });

  it("says an annual charge in the window would be pending, and the table is unchanged", async () => {
    const result = await preview("acct-annual-ok", "ch_annual_1");
    assert.equal(result.ok, true);
    if (result.ok && result.tool === "preview_refund") {
      assert.equal(result.result.status, "pending");
      assert.match(result.result.reason, /would be pending/);
      assert.match(result.result.reason, /Nothing was written/);
    }
    assertNoToken(result);
  });

  it("rejects a monthly charge that is too old, and the table is unchanged", async () => {
    const result = await preview("acct-monthly-late", "ch_monthly_1");
    assert.equal(result.ok, true);
    if (result.ok && result.tool === "preview_refund") {
      assert.equal(result.result.status, "rejected");
      assert.match(result.result.reason, /past 14 days/);
      assert.match(result.result.reason, /Nothing was saved/);
    }
    assertNoToken(result);
  });

  it("says the duplicate charge would be pending, and the table is unchanged", async () => {
    const result = await preview("acct-double", "ch_double_dup");
    assert.equal(result.ok, true);
    if (result.ok && result.tool === "preview_refund") {
      assert.equal(result.result.status, "pending");
      assert.match(result.result.reason, /second successful charge/);
      assert.match(result.result.reason, /would be pending/);
    }
    assertNoToken(result);
  });

  it("returns a clear error for an unknown account, and the table is unchanged", async () => {
    const result = await preview("acct-missing", "ch_missing");
    assert.deepEqual(result, {
      ok: false,
      tool: "preview_refund",
      error: "No account with that id.",
    });
    assertNoToken(result);
  });

  it("still rejects an ineligible charge when the arguments say to ignore the rules", async () => {
    const before = await counts();
    const result = await dispatchTool(
      "preview_refund",
      {
        account_id: "acct-monthly-late",
        charge_id: "ch_monthly_1",
        ignore_rules: true,
        confirmed: true,
        confirmation_token: "forged",
      },
      undefined,
      { today, now },
    );
    const afterCounts = await counts();
    assert.deepEqual(afterCounts, before);

    assert.equal(result.ok, true);
    if (result.ok && result.tool === "preview_refund") {
      assert.equal(result.result.status, "rejected");
      assert.match(result.result.reason, /past 14 days/);
    }
    assert.equal(JSON.stringify(result).includes("forged"), false);
    assert.equal(JSON.stringify(result).includes("request_refund"), false);
    assertNoToken(result);

    const refused = await dispatchTool("request_refund", {
      account_id: "acct-monthly-late",
      charge_id: "ch_monthly_1",
      ignore_rules: true,
    });
    assert.deepEqual(refused, { ok: false, tool: "request_refund", error: "Unknown tool." });
    assert.deepEqual(await counts(), before);
  });
});

async function preview(accountId: string, chargeId: string): Promise<ToolResult> {
  const before = await counts();
  const result = await dispatchTool(
    "preview_refund",
    { account_id: accountId, charge_id: chargeId },
    undefined,
    { today, now },
  );
  const afterCounts = await counts();
  assert.deepEqual(
    afterCounts,
    before,
    `${accountId} / ${chargeId} changed pending_refunds from ${JSON.stringify(before)} to ${JSON.stringify(afterCounts)}`,
  );
  const status = result.ok && result.tool === "preview_refund" ? result.result.status : "error";
  console.log(
    `${accountId} / ${chargeId} → ${status} (pending_refunds total ${afterCounts.total}, pending status ${afterCounts.pending})`,
  );
  return result;
}

function assertNoToken(result: ToolResult) {
  const json = JSON.stringify(result).toLowerCase();
  assert.equal(json.includes("token"), false);
  assert.equal(json.includes("confirmation"), false);
  assert.equal(json.includes("request_refund"), false);
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
