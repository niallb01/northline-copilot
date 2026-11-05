/**
 * Checks policy source paths used when appending citations to chat replies.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectPolicySourcePaths, formatPolicySourcePath, prefersRefundWindows } from "./policy";

describe("formatPolicySourcePath", () => {
  it("maps a document id to the policy-desk markdown file and chunk anchor", () => {
    assert.equal(
      formatPolicySourcePath("refunds", "refunds-annual-plans"),
      "policy-desk/refunds.md#refunds-annual-plans",
    );
  });
});

describe("collectPolicySourcePaths", () => {
  it("dedupes passages into source paths", () => {
    assert.deepEqual(
      collectPolicySourcePaths([
        {
          documentId: "refunds",
          chunkId: "refunds-monthly-plans",
          sourceTitle: "Refunds",
          passage: "…",
        },
        {
          documentId: "refunds",
          chunkId: "refunds-monthly-plans",
          sourceTitle: "Refunds",
          passage: "…",
        },
      ]),
      ["policy-desk/refunds.md#refunds-monthly-plans"],
    );
  });
});

describe("prefersRefundWindows", () => {
  it("routes vague refund questions to the day windows and leaves payout and unsupported questions alone", () => {
    assert.equal(prefersRefundWindows("what is our refund policy?"), true);
    assert.equal(prefersRefundWindows("what is the timeline for refunds?"), true);
    assert.equal(prefersRefundWindows("what are refund rules for eligibility no in terms of days"), true);
    assert.equal(prefersRefundWindows("What is the annual plan refund window?"), true);
    assert.equal(prefersRefundWindows("What is the crypto refund rule?"), false);
    assert.equal(prefersRefundWindows("how approved refund money is returned"), false);
  });
});
