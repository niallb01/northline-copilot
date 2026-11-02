/**
 * Checks that audit arguments stay a JSON object and that API keys, tokens, and
 * configured secrets are removed before anything is stored. These tests do not
 * open a database or insert a row.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { sanitizeAuditArguments, toolNameForAudit } from "./audit";

const previousSecret = process.env.SESSION_SECRET;

afterEach(() => {
  if (previousSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSecret;
});

describe("audit argument redaction", { concurrency: 1 }, () => {
  it("keeps an account id and drops secret-shaped values", () => {
    const cleaned = sanitizeAuditArguments({
      account_id: "acct-annual-ok",
      api_key: "sk-testsecretvalue",
      confirmation_token: "forged-token",
      note: "postgres://user:secret@localhost:5432/northline",
    });

    assert.deepEqual(cleaned, {
      account_id: "acct-annual-ok",
      api_key: "[redacted]",
      confirmation_token: "[redacted]",
      note: "[redacted]",
    });
    const dumped = JSON.stringify(cleaned);
    assert.equal(dumped.includes("sk-testsecretvalue"), false);
    assert.equal(dumped.includes("forged-token"), false);
    assert.equal(dumped.includes("postgres://"), false);
  });

  it("removes a configured secret from an ordinary field", () => {
    process.env.SESSION_SECRET = "northline-session-secret-value";
    const cleaned = sanitizeAuditArguments({
      account_id: "acct-missing",
      note: "prefix northline-session-secret-value suffix",
    });

    assert.equal(cleaned.account_id, "acct-missing");
    assert.equal(cleaned.note, "prefix [redacted] suffix");
    assert.equal(JSON.stringify(cleaned).includes("northline-session-secret-value"), false);
  });

  it("stores arguments that are not an object as an empty object", () => {
    assert.deepEqual(sanitizeAuditArguments("acct-missing"), {});
    assert.deepEqual(sanitizeAuditArguments(["acct-missing"]), {});
    assert.deepEqual(sanitizeAuditArguments(null), {});
  });

  it("uses unknown when the tool name is blank or unsafe", () => {
    assert.equal(toolNameForAudit("get_account"), "get_account");
    assert.equal(toolNameForAudit(" request_refund "), "request_refund");
    assert.equal(toolNameForAudit(""), "unknown");
    assert.equal(toolNameForAudit("Refund Now!"), "unknown");
  });
});
