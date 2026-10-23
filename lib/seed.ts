/**
 * The three fictional Northline customers used in tests and (later) the database seed.
 * Each story is fixed on purpose: one refund should pass, one should fail for being too
 * old, and one has a duplicate charge on the same invoice. STORY_TODAY is the pretend
 * calendar date tests use so those stories stay stable. Do not change what these three mean.
 */

import type { Account } from "./types";

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
