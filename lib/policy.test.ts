/**
 * Checks policy source paths used when appending citations to chat replies.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectPolicySourcePaths, formatPolicySourcePath, policyRouteKeys, prefersRefundWindows } from "./policy";

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
    assert.equal(prefersRefundWindows("is he eligible for a refund"), false);
  });
});

describe("policyRouteKeys", () => {
  it("sends vague operator wording to the stored section", () => {
    const cases: Array<[string, string]> = [
      ["what happens if their card payment fails?", "billing-failed-payments"],
      ["the customer says they were charged twice", "billing-double-charges"],
      ["when do invoices go out?", "billing-invoices"],
      ["the site is down, who do I pass this to?", "escalation-engineering"],
      ["should I send a billing complaint to engineering?", "escalation-stay-on-the-front-line"],
      ["everyone is getting an error after the release", "auth-403-runbook-first-check"],
      ["what does the cheapest plan include?", "plans-and-sla-starter"],
      ["what support do mid-tier customers get?", "plans-and-sla-growth"],
      ["how reliable is the top plan?", "plans-and-sla-scale"],
      ["they want money off because the service was down", "plans-and-sla-service-credits"],
      ["when does the refund actually hit their bank?", "refunds-how-the-money-is-returned"],
      ["what is our refund policy?", "refunds-monthly-plans"],
    ];
    for (const [question, chunkId] of cases) {
      const keys = policyRouteKeys(question);
      assert.ok(keys?.some((key) => key.chunkId === chunkId), question);
    }
    assert.equal(policyRouteKeys("What is the crypto refund rule?"), null);
    assert.equal(policyRouteKeys("office snack policy"), null);
  });
});
