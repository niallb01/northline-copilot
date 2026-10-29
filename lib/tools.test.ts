/**
 * Checks the tool dispatcher: get_account and list_charges call the account
 * readers, preview_refund uses the refund rules without appending a pending
 * row, bad arguments are rejected, and a missing account is a plain not-found
 * error. These tests pass in stand-in readers. They do not open a database,
 * call OpenAI, or start Next.js.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seedAccounts, STORY_TODAY } from "./seed";
import { ACCOUNT_NOT_FOUND, dispatchTool, eligibleProposal, type ToolReaders } from "./tools";
import type { Account, Charge, PendingRefund } from "./types";

const today = new Date(2026, 9, 22);
const now = new Date(`${STORY_TODAY}T12:00:00.000Z`);

const priya = seedAccounts[0];
const amina = seedAccounts[2];

function readers(overrides: Partial<ToolReaders> = {}): ToolReaders {
  return {
    async getAccount(): Promise<Account | null> {
      throw new Error("getAccount was not expected");
    },
    async listCharges(): Promise<Charge[]> {
      throw new Error("listCharges was not expected");
    },
    async listPending(): Promise<PendingRefund[]> {
      throw new Error("listPending was not expected");
    },
    ...overrides,
  };
}

describe("tool dispatcher", () => {
  it("returns the account JSON for get_account", async () => {
    const result = await dispatchTool(
      "get_account",
      { account_id: "acct-annual-ok" },
      readers({
        async getAccount(accountKey) {
          assert.equal(accountKey, "acct-annual-ok");
          return priya;
        },
      }),
    );

    assert.equal(result.ok, true);
    if (result.ok && result.tool === "get_account") {
      assert.equal(result.result.customerName, "Priya Shah");
      assert.equal(result.result.charges[0].chargeId, "ch_annual_1");
    }
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  });

  it("returns a clear not-found error for get_account acct-missing", async () => {
    const result = await dispatchTool(
      "get_account",
      { account_id: "acct-missing" },
      readers({
        async getAccount(accountKey) {
          assert.equal(accountKey, "acct-missing");
          return null;
        },
      }),
    );

    assert.deepEqual(result, {
      ok: false,
      tool: "get_account",
      error: ACCOUNT_NOT_FOUND,
    });
    const json = JSON.stringify(result);
    assert.equal(json.includes("stack"), false);
    assert.equal(json.includes("    at "), false);
    assert.equal(result.error, "No account with that id.");
  });

  it("returns charge lines from list_charges", async () => {
    const result = await dispatchTool(
      "list_charges",
      { account_id: "  acct-double  " },
      readers({
        async getAccount() {
          return amina;
        },
        async listCharges(accountId) {
          assert.equal(accountId, "acct-double");
          return amina.charges;
        },
      }),
    );

    assert.equal(result.ok, true);
    if (result.ok && result.tool === "list_charges") {
      assert.deepEqual(
        result.result.map((charge) => charge.chargeId),
        ["ch_double_1", "ch_double_dup"],
      );
    }
  });

  it("asks list_charges for the id getAccount resolved", async () => {
    let listed: string | undefined;
    const result = await dispatchTool(
      "list_charges",
      { account_id: "Priya Shah" },
      readers({
        async getAccount(accountKey) {
          assert.equal(accountKey, "Priya Shah");
          return priya;
        },
        async listCharges(accountId) {
          listed = accountId;
          return priya.charges;
        },
      }),
    );

    assert.equal(listed, "acct-annual-ok");
    assert.equal(result.ok, true);
    if (result.ok && result.tool === "list_charges") {
      assert.equal(result.result[0].chargeId, "ch_annual_1");
    }
  });

  it("returns not-found for list_charges when the account is missing", async () => {
    const result = await dispatchTool(
      "list_charges",
      { account_id: "acct-missing" },
      readers({
        async getAccount() {
          return null;
        },
      }),
    );

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, ACCOUNT_NOT_FOUND);
  });

  it("rejects an unknown tool and bad arguments before calling lib", async () => {
    const idle = readers();

    const unknown = await dispatchTool("request_refund", { account_id: "acct-annual-ok" }, idle);
    assert.deepEqual(unknown, { ok: false, tool: "request_refund", error: "Unknown tool." });

    const missingArgs = await dispatchTool("get_account", {}, idle);
    assert.equal(missingArgs.ok, false);
    if (!missingArgs.ok) assert.equal(missingArgs.error, "account_id must be a string.");

    const blank = await dispatchTool("get_account", { account_id: "   " }, idle);
    assert.equal(blank.ok, false);
    if (!blank.ok) assert.equal(blank.error, "account_id is required.");

    const notObject = await dispatchTool("list_charges", "acct-double", idle);
    assert.equal(notObject.ok, false);
    if (!notObject.ok) assert.equal(notObject.error, "Tool arguments must be an object.");
  });

  it("keeps a thrown lookup as a one-line error with no stack", async () => {
    const failure = new Error("Could not read account: connection reset");
    failure.stack = `${failure.message}\n    at getAccount (lib/accounts.ts:26:11)`;

    const result = await dispatchTool(
      "get_account",
      { account_id: "acct-annual-ok" },
      readers({
        async getAccount() {
          throw failure;
        },
      }),
    );

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "Could not read account: connection reset");
    const json = JSON.stringify(result);
    assert.equal(json.includes("lib/accounts.ts"), false);
    assert.equal(json.includes("    at "), false);
  });

  it("previews an in-window annual charge as pending and leaves the pending list unchanged", async () => {
    const pending: PendingRefund[] = [];
    const result = await dispatchTool(
      "preview_refund",
      { account_id: " acct-annual-ok ", charge_id: " ch_annual_1 " },
      readers({
        async getAccount() {
          return priya;
        },
        async listPending(accountId) {
          assert.equal(accountId, "acct-annual-ok");
          return pending;
        },
      }),
      { today, now },
    );

    assert.equal(pending.length, 0);
    assert.equal(result.ok, true);
    if (result.ok && result.tool === "preview_refund") {
      assert.equal(result.result.status, "pending");
      assert.match(result.result.reason, /would be pending/);
      assert.match(result.result.reason, /Nothing was written/);
    }
    assert.equal(proposalText(result).includes("token"), false);
    assert.equal(proposalText(result).includes("confirmation"), false);
    assert.equal(proposalText(result).includes("request_refund"), false);
    assert.deepEqual(eligibleProposal(result), {
      accountId: "acct-annual-ok",
      chargeId: "ch_annual_1",
      action: "request_refund",
    });
  });

  it("previews a monthly charge that is too old as rejected", async () => {
    const tom = seedAccounts[1];
    const result = await dispatchTool(
      "preview_refund",
      {
        account_id: "acct-monthly-late",
        charge_id: "ch_monthly_1",
        ignore_rules: true,
        confirmed: true,
        confirmation_token: "forged",
      },
      readers({
        async getAccount() {
          return tom;
        },
        async listPending() {
          return [];
        },
      }),
      { today, now },
    );

    assert.equal(result.ok, true);
    if (result.ok && result.tool === "preview_refund") {
      assert.equal(result.result.status, "rejected");
      assert.match(result.result.reason, /past 14 days/);
    }
    assert.equal(eligibleProposal(result), null);
    assert.equal(proposalText(result).includes("forged"), false);
    assert.equal(proposalText(result).includes("token"), false);
    assert.equal(proposalText(result).includes("request_refund"), false);
  });

  it("previews the duplicate charge as pending", async () => {
    const result = await dispatchTool(
      "preview_refund",
      { account_id: "acct-double", charge_id: "ch_double_dup" },
      readers({
        async getAccount() {
          return amina;
        },
        async listPending() {
          return [];
        },
      }),
      { today, now },
    );

    assert.equal(result.ok, true);
    if (result.ok && result.tool === "preview_refund") {
      assert.equal(result.result.status, "pending");
      assert.match(result.result.reason, /second successful charge/);
      assert.match(result.result.reason, /would be pending/);
    }
    assert.equal(proposalText(result).includes("request_refund"), false);
  });

  it("returns a clear error for preview_refund when the account is missing", async () => {
    let listed = false;
    const result = await dispatchTool(
      "preview_refund",
      { account_id: "acct-missing", charge_id: "ch_annual_1" },
      readers({
        async getAccount() {
          return null;
        },
        async listPending() {
          listed = true;
          return [];
        },
      }),
      { today, now },
    );

    assert.equal(listed, false);
    assert.deepEqual(result, {
      ok: false,
      tool: "preview_refund",
      error: ACCOUNT_NOT_FOUND,
    });
    assert.equal(eligibleProposal(result), null);
  });
});

function proposalText(result: unknown): string {
  return JSON.stringify(result).toLowerCase();
}
