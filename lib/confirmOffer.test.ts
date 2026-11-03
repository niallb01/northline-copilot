import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { confirmOfferFromProposal } from "./confirmOffer";

describe("confirmOfferFromProposal", () => {
  it("describes Priya’s annual charge for the confirm panel", () => {
    const offer = confirmOfferFromProposal({
      accountId: "acct-annual-ok",
      chargeId: "ch_annual_1",
      action: "request_refund",
    });
    assert.ok(offer);
    assert.equal(offer.customerName, "Priya Shah");
    assert.equal(offer.accountNumber, "NL-1048291");
    assert.equal(offer.planLabel, "Annual plan");
    assert.match(offer.chargeSummary, /£1,788\.00 charge on 11 Oct 2026/);
    assert.equal(offer.chargeSummary.includes("ch_annual"), false);
  });

  it("clears the confirm offer when the turn has no eligible proposal", () => {
    assert.equal(confirmOfferFromProposal(null), null);
  });

  it("labels a duplicate charge for Amina", () => {
    const offer = confirmOfferFromProposal({
      accountId: "acct-double",
      chargeId: "ch_double_dup",
      action: "request_refund",
    });
    assert.ok(offer);
    assert.equal(offer.customerName, "Amina Okonkwo");
    assert.match(offer.chargeSummary, /2 of 2 on this invoice/);
  });
});
