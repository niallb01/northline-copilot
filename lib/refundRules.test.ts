/**
 * Checks that requestRefund behaves correctly for the three seed accounts and a few edge
 * cases (unknown account, second request while already pending). These tests call the
 * rule code directly with in-memory data—no database, no model, no HTTP.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { previewRefund, requestRefund } from "./refundRules";
import { seedAccounts, STORY_TODAY } from "./seed";
import type { PendingRefund } from "./types";

const today = new Date(2026, 9, 22);
const now = new Date(`${STORY_TODAY}T12:00:00.000Z`);

function ask(accountId: string, chargeId: string, pending: PendingRefund[] = []) {
  return requestRefund({
    accountId,
    chargeId,
    accounts: seedAccounts,
    pending,
    today,
    now,
  });
}

describe("refund rules for the three seed accounts", () => {
  it("queues an annual charge that is 11 days old", () => {
    const pending: PendingRefund[] = [];
    const result = ask("acct-annual-ok", "ch_annual_1", pending);

    assert.equal(result.started, true);
    assert.equal(result.status, "pending");
    assert.match(result.reason, /11 days old \(within 30 days\)/);
    assert.match(result.reason, /No money has been sent/);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].chargeId, "ch_annual_1");
    assert.equal(pending[0].status, "pending");
    assert.equal(pending[0].amount, 1788);
  });

  it("rejects a monthly charge that is 41 days old and saves nothing", () => {
    const pending: PendingRefund[] = [];
    const result = ask("acct-monthly-late", "ch_monthly_1", pending);

    assert.equal(result.started, false);
    assert.equal(result.status, "rejected");
    assert.match(result.reason, /41 days old \(past 14 days\)/);
    assert.match(result.reason, /Nothing was saved/);
    assert.equal(pending.length, 0);
  });

  it("queues the duplicate charge even though the date is old", () => {
    const pending: PendingRefund[] = [];
    const result = ask("acct-double", "ch_double_dup", pending);

    assert.equal(result.started, true);
    assert.equal(result.status, "pending");
    assert.match(result.reason, /second successful charge on invoice in_double_1/);
    assert.match(result.reason, /original charge ch_double_1/);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].chargeId, "ch_double_dup");
  });

  it("does not treat the first charge on a doubled invoice as the duplicate", () => {
    const pending: PendingRefund[] = [];
    const result = ask("acct-double", "ch_double_1", pending);

    assert.equal(result.status, "rejected");
    assert.match(result.reason, /past 14 days/);
    assert.equal(pending.length, 0);
  });

  it("rejects a second request for the same pending charge", () => {
    const pending: PendingRefund[] = [];
    const first = ask("acct-annual-ok", "ch_annual_1", pending);
    const second = ask("acct-annual-ok", "ch_annual_1", pending);

    assert.equal(first.status, "pending");
    assert.equal(second.started, false);
    assert.equal(second.status, "rejected");
    assert.match(second.reason, /already pending/);
    assert.match(second.reason, /Nothing new was saved/);
    assert.equal(pending.length, 1);
  });

  it("returns a clear error for an unknown account and saves nothing", () => {
    const pending: PendingRefund[] = [];
    const result = ask("acct-missing", "ch_annual_1", pending);

    assert.equal(result.status, "rejected");
    assert.equal(result.reason, 'No account with id "acct-missing".');
    assert.equal(pending.length, 0);
  });
});

describe("previewRefund", () => {
  it("says an in-window annual charge would be pending and appends nothing", () => {
    const pending: PendingRefund[] = [];
    const result = previewRefund({
      accountId: "acct-annual-ok",
      chargeId: "ch_annual_1",
      accounts: seedAccounts,
      pending,
      today,
      now,
    });

    assert.equal(result.started, false);
    assert.equal(result.status, "pending");
    assert.match(result.reason, /11 days old \(within 30 days\)/);
    assert.match(result.reason, /would be pending/);
    assert.match(result.reason, /Nothing was written/);
    assert.equal(result.reason.includes("Refund started"), false);
    assert.equal(pending.length, 0);
  });

  it("rejects a monthly charge that is too old and appends nothing", () => {
    const pending: PendingRefund[] = [];
    const result = previewRefund({
      accountId: "acct-monthly-late",
      chargeId: "ch_monthly_1",
      accounts: seedAccounts,
      pending,
      today,
      now,
    });

    assert.equal(result.started, false);
    assert.equal(result.status, "rejected");
    assert.match(result.reason, /41 days old \(past 14 days\)/);
    assert.match(result.reason, /Nothing was saved/);
    assert.equal(pending.length, 0);
  });

  it("says the duplicate charge would be pending and appends nothing", () => {
    const pending: PendingRefund[] = [];
    const result = previewRefund({
      accountId: "acct-double",
      chargeId: "ch_double_dup",
      accounts: seedAccounts,
      pending,
      today,
      now,
    });

    assert.equal(result.status, "pending");
    assert.match(result.reason, /second successful charge on invoice in_double_1/);
    assert.match(result.reason, /would be pending/);
    assert.equal(pending.length, 0);
  });
});
