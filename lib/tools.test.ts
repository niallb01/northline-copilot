/**
 * Checks the tool dispatcher: get_account and list_charges call the account
 * readers, bad arguments are rejected, and a missing account is a plain
 * not-found error. These tests pass in stand-in readers. They do not open a
 * database, call OpenAI, or start Next.js.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seedAccounts } from "./seed";
import { ACCOUNT_NOT_FOUND, dispatchTool, type ToolReaders } from "./tools";
import type { Account, Charge } from "./types";

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

    const unknown = await dispatchTool("preview_refund", { account_id: "acct-annual-ok" }, idle);
    assert.deepEqual(unknown, { ok: false, tool: "preview_refund", error: "Unknown tool." });

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
});
