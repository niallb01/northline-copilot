import type { Account } from "./types";

/**
 * The three accounts from northline-desk/accounts.json.
 * Dates are fixed. Tests pin "today" to 2026-10-22 so the windows stay true:
 * annual charge is 11 days old, monthly charge is 41 days old, duplicate is old.
 * Do not change what these three mean. Extra histories for evals come later.
 */
export const STORY_TODAY = "2026-10-22";

export const seedAccounts: Account[] = [
  {
    id: "acct-annual-ok",
    plan: "annual",
    customerName: "Priya Shah",
    charges: [
      {
        invoiceId: "in_annual_1",
        chargeId: "ch_annual_1",
        amount: 1788,
        date: "2026-10-11",
        status: "succeeded",
      },
    ],
  },
  {
    id: "acct-monthly-late",
    plan: "monthly",
    customerName: "Tom Ellis",
    charges: [
      {
        invoiceId: "in_monthly_1",
        chargeId: "ch_monthly_1",
        amount: 49,
        date: "2026-09-11",
        status: "succeeded",
      },
    ],
  },
  {
    id: "acct-double",
    plan: "monthly",
    customerName: "Amina Okonkwo",
    charges: [
      {
        invoiceId: "in_double_1",
        chargeId: "ch_double_1",
        amount: 149,
        date: "2026-07-23",
        status: "succeeded",
      },
      {
        invoiceId: "in_double_1",
        chargeId: "ch_double_dup",
        amount: 149,
        date: "2026-07-23",
        status: "succeeded",
      },
    ],
  },
];
