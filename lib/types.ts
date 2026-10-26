/**
 * Shared shapes for Northline demo data: what an account, a charge, a queued refund,
 * and a refund decision look like in TypeScript. A queued refund is pending until a
 * person marks it reviewed. Reviewed does not mean money was sent. This file does not
 * read a database or call OpenAI; it only describes the fields the rest of lib/ agrees on.
 */

export type Plan = "annual" | "monthly";

export type ChargeStatus = "succeeded" | "failed" | "refunded";

export type Charge = {
  invoiceId: string;
  chargeId: string;
  amount: number;
  date: string;
  status: ChargeStatus;
};

export type Account = {
  id: string;
  accountNumber: string;
  plan: Plan;
  customerName: string;
  charges: Charge[];
};

export type PendingRefund = {
  accountId: string;
  customerName: string;
  plan: Plan;
  chargeId: string;
  invoiceId: string;
  amount: number;
  chargeDate: string;
  status: "pending" | "reviewed";
  reason: string;
  startedAt: string;
};

export type RefundResult = {
  started: boolean;
  status: "pending" | "rejected";
  accountId: string;
  chargeId: string;
  reason: string;
};
