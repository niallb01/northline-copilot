/**
 * Checks that a chat turn's token counts are whole numbers at or above zero
 * before they are stored. These tests do not open a database or insert a row.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tokenCountsForStorage } from "./tokenUsage";

describe("token counts for storage", () => {
  it("keeps the prompt, completion, and total from the usage object", () => {
    assert.deepEqual(
      tokenCountsForStorage({
        promptTokens: 42,
        completionTokens: 7,
        totalTokens: 49,
      }),
      { promptTokens: 42, completionTokens: 7, totalTokens: 49 },
    );
  });

  it("rejects a count that is missing, negative, or not a whole number", () => {
    assert.equal(
      tokenCountsForStorage({
        promptTokens: -1,
        completionTokens: 7,
        totalTokens: 6,
      }),
      null,
    );
    assert.equal(
      tokenCountsForStorage({
        promptTokens: 1.5,
        completionTokens: 1,
        totalTokens: 2,
      }),
      null,
    );
    assert.equal(
      tokenCountsForStorage({
        promptTokens: Number.NaN,
        completionTokens: 1,
        totalTokens: 1,
      }),
      null,
    );
  });
});
