/**
 * The refund a signed-in operator may confirm, and the sentences the workspace
 * shows after that confirm. This file does not read cookies, call queueRefund,
 * insert a row, or carry a confirmation token.
 */

import { seedAccounts } from "./seed";
import type { Account, Charge } from "./types";

export const REFUND_NOT_STARTED = "The refund was not started.";

export const REFUND_QUEUED = "Refund queued for review. No money has been sent.";

export type ConfirmOffer = {
  accountId: string;
  chargeId: string;
  action: "request_refund";
  /** Shown on the confirm panel instead of internal ids. */
  customerName: string;
  accountNumber: string;
  planLabel: string;
  chargeSummary: string;
};

/** Ids to show on the confirm control. Null when the preview was not eligible. */
export function confirmOfferFromProposal(
  proposal: { accountId: string; chargeId: string; action: "request_refund" } | null,
): ConfirmOffer | null {
  if (!proposal || proposal.action !== "request_refund") return null;
  const accountId = proposal.accountId.trim();
  const chargeId = proposal.chargeId.trim();
  if (!accountId || !chargeId || accountId.length > 80 || chargeId.length > 80) return null;
  const display = describeRefundForOperator(accountId, chargeId);
  return {
    accountId,
    chargeId,
    action: "request_refund",
    ...display,
  };
}

function describeRefundForOperator(
  accountId: string,
  chargeId: string,
): Pick<ConfirmOffer, "customerName" | "accountNumber" | "planLabel" | "chargeSummary"> {
  const account = seedAccounts.find((row) => row.id === accountId);
  if (!account) {
    return {
      customerName: "Customer",
      accountNumber: "",
      planLabel: "",
      chargeSummary: "Selected charge",
    };
  }

  const charge = account.charges.find((row) => row.chargeId === chargeId);
  return {
    customerName: account.customerName,
    accountNumber: account.accountNumber,
    planLabel: formatPlanLabel(account),
    chargeSummary: charge ? formatChargeSummary(charge, account.charges) : "Selected charge",
  };
}

function formatPlanLabel(account: Account): string {
  return account.plan === "annual" ? "Annual plan" : "Monthly plan";
}

function formatChargeSummary(charge: Charge, allCharges: Charge[]): string {
  const amount = formatMoney(charge.amount);
  const date = formatChargeDate(charge.date);
  const duplicateNote = duplicateChargeNote(charge, allCharges);
  return duplicateNote
    ? `${amount} charge on ${date} (${duplicateNote})`
    : `${amount} charge on ${date}`;
}

function duplicateChargeNote(charge: Charge, allCharges: Charge[]): string | null {
  const onSameInvoice = allCharges.filter(
    (row) => row.invoiceId === charge.invoiceId && row.status === "succeeded",
  );
  if (onSameInvoice.length < 2) return null;
  const index =
    onSameInvoice.findIndex((row) => row.chargeId === charge.chargeId) + 1;
  if (index < 1) return null;
  return `${index} of ${onSameInvoice.length} on this invoice`;
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(amount);
}

function formatChargeDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
