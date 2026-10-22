import type { Account, PendingRefund, RefundResult } from "./types";

const ANNUAL_WINDOW_DAYS = 30;
const MONTHLY_WINDOW_DAYS = 14;

export type RequestRefundInput = {
  accountId: string;
  chargeId: string;
  accounts: Account[];
  pending: PendingRefund[];
  /** Local calendar day used for the window. Defaults to today. */
  today?: Date;
  now?: Date;
};

function rejected(accountId: string, chargeId: string, reason: string): RefundResult {
  return {
    started: false,
    status: "rejected",
    accountId,
    chargeId,
    reason,
  };
}

function ageInDays(dateString: string, today: Date): number {
  const [year, month, day] = dateString.split("-").map(Number);
  const chargeDate = new Date(year, month - 1, day);
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((todayDate.getTime() - chargeDate.getTime()) / msPerDay);
}

/** First successful charge on the invoice is the original. Later ones are duplicates. */
function originalCharge(account: Account, chargeId: string, invoiceId: string) {
  const successful = account.charges.filter(
    (item) => item.invoiceId === invoiceId && item.status === "succeeded"
  );

  if (successful.length < 2) {
    return null;
  }

  if (successful[0].chargeId === chargeId) {
    return null;
  }

  return successful[0];
}

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
  const { accountId, chargeId, accounts, pending } = input;
  const today = input.today ?? new Date();
  const now = input.now ?? new Date();

  if (!accountId.trim() || !chargeId.trim()) {
    return rejected(
      accountId,
      chargeId,
      "Account id and charge id are required. Nothing was saved."
    );
  }

  const account = accounts.find((item) => item.id === accountId);
  if (!account) {
    return rejected(accountId, chargeId, `No account with id "${accountId}".`);
  }

  const charge = account.charges.find((item) => item.chargeId === chargeId);
  if (!charge) {
    return rejected(
      accountId,
      chargeId,
      `No charge "${chargeId}" on account "${accountId}".`
    );
  }

  if (charge.status !== "succeeded") {
    return rejected(
      accountId,
      chargeId,
      `Charge ${chargeId} has status "${charge.status}", so a refund cannot be started. Nothing was saved.`
    );
  }

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

  const original = originalCharge(account, charge.chargeId, charge.invoiceId);
  if (original) {
    const reason = `Charge ${charge.chargeId} is a second successful charge on invoice ${charge.invoiceId} (original charge ${original.chargeId}). Refund started as pending for a person to approve. No money has been sent.`;
    pending.push({
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
    return {
      started: true,
      status: "pending",
      accountId: account.id,
      chargeId: charge.chargeId,
      reason,
    };
  }

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

  if (age <= windowDays) {
    const reason = `${planLabel} charge is ${age} days old (within ${windowDays} days). Refund started as pending for a person to approve. No money has been sent.`;
    pending.push({
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
    return {
      started: true,
      status: "pending",
      accountId: account.id,
      chargeId: charge.chargeId,
      reason,
    };
  }

  return rejected(
    accountId,
    chargeId,
    `${planLabel} charge is ${age} days old (past ${windowDays} days). Refund not started. Nothing was saved.`
  );
}
