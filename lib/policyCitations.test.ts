/**
 * Checks that a policy quote counts only when it names a passage from that
 * turn and the words are inside that passage. These tests use fixed strings.
 * They do not embed, open a database, or call the model.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptPolicyQuote,
  POLICY_REFUSAL,
  quoteAppearsInPassage,
  settlePolicyCitations,
} from "./policyCitations";

const annual =
  "An annual plan can be refunded in full when the request arrives within 30 days of the charge.";
const monthly =
  "A monthly charge can be refunded in full when the request arrives within 14 days of that charge.";

const passages = [
  { documentId: "refunds", chunkId: "refunds-annual-plans", passage: annual },
  { documentId: "refunds", chunkId: "refunds-monthly-plans", passage: monthly },
];

describe("acceptPolicyQuote", () => {
  it("counts a quote that is inside the named passage from the tool result", () => {
    assert.equal(
      acceptPolicyQuote(
        {
          documentId: "refunds",
          chunkId: "refunds-annual-plans",
          quote: "within 30 days of the charge",
        },
        passages,
      ),
      true,
    );
  });

  it("rejects the same words when they are cited against a different chunk", () => {
    assert.equal(
      acceptPolicyQuote(
        {
          documentId: "refunds",
          chunkId: "refunds-annual-plans",
          quote: "within 14 days of that charge",
        },
        passages,
      ),
      false,
    );
  });

  it("rejects a quote whose document id and chunk id were not in the tool result", () => {
    assert.equal(
      acceptPolicyQuote(
        {
          documentId: "refunds",
          chunkId: "refunds-not-returned",
          quote: "within 30 days of the charge",
        },
        passages,
      ),
      false,
    );
  });

  it("rejects an empty quote", () => {
    assert.equal(
      acceptPolicyQuote(
        { documentId: "refunds", chunkId: "refunds-annual-plans", quote: "   " },
        passages,
      ),
      false,
    );
  });
});

describe("quoteAppearsInPassage", () => {
  it("treats a line break in the stored passage as the same span", () => {
    assert.equal(
      quoteAppearsInPassage(
        "within 30 days of the charge",
        "An annual plan can be refunded in full when the request arrives\nwithin 30 days of the charge.",
      ),
      true,
    );
  });
});

describe("settlePolicyCitations", () => {
  it("keeps an accepted quote and drops a quote from another chunk", () => {
    const settled = settlePolicyCitations(
      `Annual plans have a window. <cite document="refunds" chunk="refunds-annual-plans">within 30 days of the charge</cite> <cite document="refunds" chunk="refunds-annual-plans">within 14 days of that charge</cite>`,
      passages,
    );

    assert.deepEqual(settled.citations, [
      {
        documentId: "refunds",
        chunkId: "refunds-annual-plans",
        quote: "within 30 days of the charge",
      },
    ]);
    assert.equal(settled.reply.includes("within 30 days of the charge"), true);
    assert.equal(settled.reply.includes("14 days"), false);
    assert.equal(settled.reply.includes("<cite"), false);
    assert.equal(settled.rejected.length, 1);
  });

  it("drops wrapping quotation marks when the words inside are in that passage", () => {
    const settled = settlePolicyCitations(
      `<cite document="refunds" chunk="refunds-annual-plans">"within 30 days of the charge"</cite>`,
      passages,
    );
    assert.deepEqual(settled.citations, [
      {
        documentId: "refunds",
        chunkId: "refunds-annual-plans",
        quote: "within 30 days of the charge",
      },
    ]);
    assert.equal(settled.reply, "within 30 days of the charge");
  });

  it("shows a cited passage once and drops the markdown heading", () => {
    const stored = `## Annual plans\n\n${annual} The charge is either the first purchase or a renewal. After day 30 the annual charge is not refunded.`;
    const settled = settlePolicyCitations(
      `An annual plan can be refunded in full when the request arrives within 30 days of the charge; after day 30 the annual charge is not refunded <cite document="refunds" chunk="refunds-annual-plans">${stored}</cite>`,
      [{ documentId: "refunds", chunkId: "refunds-annual-plans", passage: stored }],
    );
    assert.equal(settled.reply.includes("##"), false);
    assert.equal(settled.reply.includes("Annual plans An annual"), false);
    assert.equal(
      settled.reply,
      `${annual} The charge is either the first purchase or a renewal. After day 30 the annual charge is not refunded.`,
    );
  });

  it("keeps a space when a cite tag is glued to the previous sentence", () => {
    const settled = settlePolicyCitations(
      `Annual plans have a window.<cite document="refunds" chunk="refunds-annual-plans">within 30 days of the charge</cite>`,
      passages,
    );
    assert.equal(settled.reply, "Annual plans have a window. within 30 days of the charge");
  });

  it("drops a cite when search returned no passage and leaves the surrounding refusal", () => {
    const settled = settlePolicyCitations(
      `The stored policy does not cover that topic. <cite document="refunds" chunk="refunds-annual-plans">Crypto refunds are paid within 1 day.</cite>`,
      [],
    );

    assert.deepEqual(settled.citations, []);
    assert.equal(settled.reply.includes("Crypto"), false);
    assert.match(settled.reply, /does not cover/);
  });

  it("uses the refusal sentence when the only text was an invented cite and nothing was retrieved", () => {
    const settled = settlePolicyCitations(
      `<cite document="refunds" chunk="refunds-annual-plans">Crypto refunds are allowed.</cite>`,
      [],
    );

    assert.equal(settled.reply, POLICY_REFUSAL);
    assert.deepEqual(settled.citations, []);
  });
});
