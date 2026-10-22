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
  status: "pending";
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
