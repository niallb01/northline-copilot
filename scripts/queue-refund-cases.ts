/**
 * Manual check for M07. It calls queueRefund once per case, on the story date
 * 2026-10-22: annual in window, monthly too old, the duplicate charge, then the
 * same annual charge again. It deletes pending rows for those three charges first
 * so you can run it again, and it leaves the two accepted rows in the table.
 * It does not start a website, call a model, or mark anything reviewed.
 */

import { closePool, withClient } from "../lib/postgres";
import { queueRefund } from "../lib/refunds";
import { STORY_TODAY } from "../lib/seed";

const today = new Date(2026, 9, 22);
const now = new Date(`${STORY_TODAY}T12:00:00.000Z`);

const chargeIds = ["ch_annual_1", "ch_monthly_1", "ch_double_dup"];

const cases = [
  {
    accountId: "acct-annual-ok",
    chargeId: "ch_annual_1",
    status: "pending",
    rows: 1,
    reason: "within 30 days",
  },
  {
    accountId: "acct-monthly-late",
    chargeId: "ch_monthly_1",
    status: "rejected",
    rows: 0,
    reason: "past 14 days",
  },
  {
    accountId: "acct-double",
    chargeId: "ch_double_dup",
    status: "pending",
    rows: 1,
    reason: "second successful charge",
  },
  {
    accountId: "acct-annual-ok",
    chargeId: "ch_annual_1",
    status: "rejected",
    rows: 1,
    reason: "already pending",
  },
] as const;

try {
  await withClient((client) =>
    client.query("delete from public.pending_refunds where charge_id = any($1::text[])", [
      chargeIds,
    ]),
  );

  for (const item of cases) {
    const result = await queueRefund({
      accountId: item.accountId,
      chargeId: item.chargeId,
      today,
      now,
    });
    const rows = await countPending(item.accountId, item.chargeId);
    const label = rows === 1 ? "1 pending row" : `${rows} pending rows`;
    console.log(`${item.accountId} / ${item.chargeId} → ${result.status} (${label})`);
    console.log(result.reason);
    console.log("");

    if (result.status !== item.status || result.started !== (item.status === "pending")) {
      throw new Error(
        `Expected ${item.accountId} / ${item.chargeId} to be ${item.status}, got ${result.status}.`,
      );
    }
    if (!result.reason.includes(item.reason)) {
      throw new Error(
        `Expected the reason for ${item.chargeId} to mention "${item.reason}".`,
      );
    }
    if (rows !== item.rows) {
      throw new Error(`Expected ${item.rows} pending row(s) for ${item.chargeId}, found ${rows}.`);
    }
  }
} finally {
  await closePool();
}

async function countPending(accountId: string, chargeId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ n: number }>(
      `select count(*)::int as n
       from public.pending_refunds
       where account_id = $1 and charge_id = $2 and status = 'pending'`,
      [accountId, chargeId],
    );
    const n = result.rows[0]?.n;
    if (typeof n !== "number") {
      throw new Error("Pending count from the database was not a number.");
    }
    return n;
  });
}
