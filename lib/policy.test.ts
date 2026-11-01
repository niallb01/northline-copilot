/**
 * Checks policy source paths used when appending citations to chat replies.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectPolicySourcePaths, formatPolicySourcePath } from "./policy";

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
