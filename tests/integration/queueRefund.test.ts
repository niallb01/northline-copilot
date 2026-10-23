/**
 * Persistence checks for queueRefund against real Postgres. Each case calls
 * lib/refunds.ts, which calls requestRefund in lib/refundRules.ts, with today
 * fixed at 2026-10-22. The tests delete pending rows for the charges they touch
 * so a previous run cannot change the result. They do not copy refund windows,
 * start a website, or mark anything reviewed.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closePool, withClient } from "../../lib/postgres";
import { queueRefund } from "../../lib/refunds";
import { STORY_TODAY } from "../../lib/seed";
import type { RefundResult } from "../../lib/types";

const today = new Date(2026, 9, 22);
const now = new Date(`${STORY_TODAY}T12:00:00.000Z`);

const touchedCharges = ["ch_annual_1", "ch_monthly_1", "ch_double_dup"];

describe("queueRefund persistence", { concurrency: 1 }, () => {
  before(async () => {
    await deletePending(touchedCharges);
  });

  after(async () => {
    try {
      await deletePending(touchedCharges);
    } finally {
      await closePool();
    }
  });

  it("queues an annual charge in the window as one pending row", async () => {
    await deletePending(["ch_annual_1"]);

    const result = await ask("acct-annual-ok", "ch_annual_1");

    assert.equal(result.started, true);
    assert.equal(result.status, "pending");
    assert.match(result.reason, /within 30 days/);
    assert.match(result.reason, /No money has been sent/);
    assert.equal(await countPending("acct-annual-ok", "ch_annual_1"), 1);
    const row = await pendingRow("acct-annual-ok", "ch_annual_1");
    assert.equal(row.invoice_id, "in_annual_1");
    assert.equal(row.amount, 1788);
    assert.equal(row.charge_date, "2026-10-11");
    assert.equal(row.status, "pending");
  });

  it("rejects a monthly charge that is too old and saves no row", async () => {
    await deletePending(["ch_monthly_1"]);

    const result = await ask("acct-monthly-late", "ch_monthly_1");

    assert.equal(result.started, false);
    assert.equal(result.status, "rejected");
    assert.match(result.reason, /past 14 days/);
    assert.match(result.reason, /Nothing was saved/);
    assert.equal(await countPending("acct-monthly-late", "ch_monthly_1"), 0);
  });

  it("queues the duplicate charge as one pending row", async () => {
    await deletePending(["ch_double_dup"]);

    const result = await ask("acct-double", "ch_double_dup");

    assert.equal(result.started, true);
    assert.equal(result.status, "pending");
    assert.match(result.reason, /second successful charge on invoice in_double_1/);
    assert.match(result.reason, /original charge ch_double_1/);
    assert.equal(await countPending("acct-double", "ch_double_dup"), 1);
    const row = await pendingRow("acct-double", "ch_double_dup");
    assert.equal(row.invoice_id, "in_double_1");
    assert.equal(row.amount, 149);
    assert.equal(row.charge_date, "2026-07-23");
    assert.equal(row.status, "pending");
  });

  it("returns a clear error for an unknown account and saves no row", async () => {
    await deletePending(["ch_annual_1"]);

    const result = await ask("acct-missing", "ch_annual_1");

    assert.equal(result.started, false);
    assert.equal(result.status, "rejected");
    assert.equal(result.reason, 'No account with id "acct-missing".');
    assert.equal(await countPending("acct-missing", "ch_annual_1"), 0);
    assert.equal(await countPendingForCharge("ch_annual_1"), 0);
  });

  it("rejects a second request while one row is pending", async () => {
    await deletePending(["ch_annual_1"]);

    const first = await ask("acct-annual-ok", "ch_annual_1");
    const second = await ask("acct-annual-ok", "ch_annual_1");

    assert.equal(first.started, true);
    assert.equal(first.status, "pending");
    assert.equal(second.started, false);
    assert.equal(second.status, "rejected");
    assert.match(second.reason, /already pending/);
    assert.match(second.reason, /Nothing new was saved/);
    assert.equal(await countPending("acct-annual-ok", "ch_annual_1"), 1);
  });

  it("keeps one pending row when two requests overlap on the same eligible charge", async () => {
    await deletePending(["ch_annual_1"]);

    const results = await Promise.all([
      ask("acct-annual-ok", "ch_annual_1"),
      ask("acct-annual-ok", "ch_annual_1"),
    ]);

    const accepted = results.filter((result) => result.started && result.status === "pending");
    const rejected = results.filter((result) => !result.started && result.status === "rejected");
    const summary = results.map((result) => `${result.status}: ${result.reason}`).join(" | ");

    assert.equal(accepted.length, 1, summary);
    assert.equal(rejected.length, 1, summary);
    assert.match(rejected[0].reason, /already pending/);
    assert.match(rejected[0].reason, /Nothing new was saved/);
    assert.equal(await countPending("acct-annual-ok", "ch_annual_1"), 1);
  });
});

function ask(accountId: string, chargeId: string): Promise<RefundResult> {
  return queueRefund({ accountId, chargeId, today, now });
}

async function deletePending(chargeIds: string[]): Promise<void> {
  await withClient((client) =>
    client.query("delete from public.pending_refunds where charge_id = any($1::text[])", [chargeIds]),
  );
}

async function countPending(accountId: string, chargeId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ n: number }>(
      `select count(*)::int as n
       from public.pending_refunds
       where account_id = $1 and charge_id = $2 and status = 'pending'`,
      [accountId, chargeId],
    );
    return asCount(result.rows[0]?.n);
  });
}

async function countPendingForCharge(chargeId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ n: number }>(
      `select count(*)::int as n
       from public.pending_refunds
       where charge_id = $1 and status = 'pending'`,
      [chargeId],
    );
    return asCount(result.rows[0]?.n);
  });
}

type PendingRow = {
  invoice_id: string;
  amount: number;
  charge_date: string;
  status: string;
};

async function pendingRow(accountId: string, chargeId: string): Promise<PendingRow> {
  return withClient(async (client) => {
    const result = await client.query<PendingRow>(
      `select invoice_id, amount, charge_date::text as charge_date, status
       from public.pending_refunds
       where account_id = $1 and charge_id = $2 and status = 'pending'`,
      [accountId, chargeId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`No pending row for ${accountId} / ${chargeId}.`);
    }
    return row;
  });
}

function asCount(value: unknown): number {
  if (typeof value !== "number") {
    throw new Error("Pending count from the database was not a number.");
  }
  return value;
}
