/**
 * The refund a signed-in operator may confirm, and the sentences the workspace
 * shows after that confirm. This file does not read cookies, call queueRefund,
 * insert a row, or carry a confirmation token.
 */

export const REFUND_NOT_STARTED = "The refund was not started.";

export const REFUND_QUEUED = "Refund queued for review. No money has been sent.";

export type ConfirmOffer = {
  accountId: string;
  chargeId: string;
  action: "request_refund";
};

/** Ids to show on the confirm control. Null when the preview was not eligible. */
export function confirmOfferFromProposal(
  proposal: { accountId: string; chargeId: string; action: "request_refund" } | null,
): ConfirmOffer | null {
  if (!proposal || proposal.action !== "request_refund") return null;
  const accountId = proposal.accountId.trim();
  const chargeId = proposal.chargeId.trim();
  if (!accountId || !chargeId || accountId.length > 80 || chargeId.length > 80) return null;
  return { accountId, chargeId, action: "request_refund" };
}
