/**
 * Decides whether a refund request may be queued for human review. It applies Northline’s
 * fixed rules (annual/monthly windows and duplicate charges on the same invoice). On accept
 * requestRefund appends one pending entry to the list you pass in; on reject it changes
 * nothing. previewRefund uses those same checks and appends nothing. This never pays
 * money—that happens only outside this app, if ever.
 */

import type { Account, PendingRefund, RefundResult } from "./types";

// PSEUDO: annual refunds allowed within 30 days; monthly within 14 days
const ANNUAL_WINDOW_DAYS = 30;
const MONTHLY_WINDOW_DAYS = 14;

// PSEUDO: everything requestRefund needs — ids, account list, pending list, optional "today"
export type RequestRefundInput = {
  accountId: string;
  chargeId: string;
  accounts: Account[];
  pending: PendingRefund[];
  /** Local calendar day used for the window. Defaults to today. */
  today?: Date;
  now?: Date;
};

// PSEUDO: return a rejected result object; caller must not append to pending
function rejected(accountId: string, chargeId: string, reason: string): RefundResult {
  return {
    started: false,
    status: "rejected",
    accountId,
    chargeId,
    reason,
  };
}

// PSEUDO: chargeDate = YYYY-MM-DD → whole days from that date to today (calendar days)
function ageInDays(dateString: string, today: Date): number {
  const [year, month, day] = dateString.split("-").map(Number);
  const chargeDate = new Date(year, month - 1, day);
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((todayDate.getTime() - chargeDate.getTime()) / msPerDay);
}

/** First successful charge on the invoice is the original. Later ones are duplicates. */
function originalCharge(account: Account, chargeId: string, invoiceId: string) {
  // PSEUDO: keep only succeeded charges on this invoice
  const successful = account.charges.filter(
    (item) => item.invoiceId === invoiceId && item.status === "succeeded"
  );

  // PSEUDO: fewer than two successes → not a duplicate scenario
  if (successful.length < 2) {
    return null;
  }

  // PSEUDO: if this charge is the first success on the invoice, it is not the duplicate
  if (successful[0].chargeId === chargeId) {
    return null;
  }

  // PSEUDO: otherwise return the first success (the original charge id)
  return successful[0];
}

// PSEUDO: map plan name → refund window in days, or null if unknown plan
function windowForPlan(plan: Account["plan"]): number | null {
  if (plan === "annual") {
    return ANNUAL_WINDOW_DAYS;
  }
  if (plan === "monthly") {
    return MONTHLY_WINDOW_DAYS;
  }
  return null;
}

/**
 * Decide a refund and, only on accept, append one pending row.
 * Reject writes nothing. This never pays anyone.
 *
 * The in-memory list is checked before insert. A database unique constraint
 * will block two pending rows for the same charge when storage is added.
 */
export function requestRefund(input: RequestRefundInput): RefundResult {
  return decideRefund(input, "write");
}

/**
 * Run the same eligibility checks as requestRefund and append nothing.
 * A pending status means the charge would be queued. It does not insert a row.
 */
export function previewRefund(input: RequestRefundInput): RefundResult {
  return decideRefund(input, "preview");
}

function decideRefund(input: RequestRefundInput, mode: "write" | "preview"): RefundResult {
  const { accountId, chargeId, accounts, pending } = input;
  const today = input.today ?? new Date();
  const now = input.now ?? new Date();

  // PSEUDO: if ids are blank → reject
  if (!accountId.trim() || !chargeId.trim()) {
    return rejected(
      accountId,
      chargeId,
      "Account id and charge id are required. Nothing was saved."
    );
  }

  // PSEUDO: find account by id → if missing, reject
  const account = accounts.find((item) => item.id === accountId);
  if (!account) {
    return rejected(accountId, chargeId, `No account with id "${accountId}".`);
  }

  // PSEUDO: find charge on that account → if missing, reject
  const charge = account.charges.find((item) => item.chargeId === chargeId);
  if (!charge) {
    return rejected(
      accountId,
      chargeId,
      `No charge "${chargeId}" on account "${accountId}".`
    );
  }

  // PSEUDO: only succeeded charges can be queued → else reject
  if (charge.status !== "succeeded") {
    return rejected(
      accountId,
      chargeId,
      `Charge ${chargeId} has status "${charge.status}", so a refund cannot be started. Nothing was saved.`
    );
  }

  // PSEUDO: if this charge already has a pending row → reject (no second queue)
  const alreadyPending = pending.some(
    (row) =>
      row.accountId === accountId &&
      row.chargeId === chargeId &&
      row.status === "pending"
  );
  if (alreadyPending) {
    return rejected(
      accountId,
      chargeId,
      "A refund for this charge is already pending. Nothing new was saved."
    );
  }

  // PSEUDO: if this charge is a duplicate on the invoice → append pending and accept
  const original = originalCharge(account, charge.chargeId, charge.invoiceId);
  if (original) {
    const reason = `Charge ${charge.chargeId} is a second successful charge on invoice ${charge.invoiceId} (original charge ${original.chargeId}). Refund started as pending for a person to approve. No money has been sent.`;
    return queueOrPreview(mode, pending, {
      accountId: account.id,
      customerName: account.customerName,
      plan: account.plan,
      chargeId: charge.chargeId,
      invoiceId: charge.invoiceId,
      amount: charge.amount,
      chargeDate: charge.date,
      status: "pending",
      reason,
      startedAt: now.toISOString(),
    });
  }

  // PSEUDO: look up plan window → if plan unknown, reject
  const windowDays = windowForPlan(account.plan);
  if (windowDays === null) {
    return rejected(
      accountId,
      chargeId,
      `Plan "${account.plan}" has no refund window in this tool. Nothing was saved.`
    );
  }

  const age = ageInDays(charge.date, today);
  const planLabel = account.plan === "annual" ? "Annual" : "Monthly";

  // PSEUDO: if charge age ≤ window → append pending and accept
  if (age <= windowDays) {
    const reason = `${planLabel} charge is ${age} days old (within ${windowDays} days). Refund started as pending for a person to approve. No money has been sent.`;
    return queueOrPreview(mode, pending, {
      accountId: account.id,
      customerName: account.customerName,
      plan: account.plan,
      chargeId: charge.chargeId,
      invoiceId: charge.invoiceId,
      amount: charge.amount,
      chargeDate: charge.date,
      status: "pending",
      reason,
      startedAt: now.toISOString(),
    });
  }

  // PSEUDO: charge too old for plan window → reject
  return rejected(
    accountId,
    chargeId,
    `${planLabel} charge is ${age} days old (past ${windowDays} days). Refund not started. Nothing was saved.`
  );
}

function queueOrPreview(
  mode: "write" | "preview",
  pending: PendingRefund[],
  row: PendingRefund,
): RefundResult {
  if (mode === "preview") {
    return {
      started: false,
      status: "pending",
      accountId: row.accountId,
      chargeId: row.chargeId,
      reason: previewReason(row.reason),
    };
  }

  pending.push(row);
  return {
    started: true,
    status: "pending",
    accountId: row.accountId,
    chargeId: row.chargeId,
    reason: row.reason,
  };
}

function previewReason(reason: string): string {
  const fact = reason.replace(
    / Refund started as pending for a person to approve\. No money has been sent\.$/,
    "",
  );
  return `${fact} A preview says this would be pending. Nothing was written.`;
}
