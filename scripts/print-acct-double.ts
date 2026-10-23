/**
 * A small manual check for M06. It loads the demo account acct-double from Postgres,
 * checks the data matches lib/seed.ts, and prints each charge id on its own line. Run it
 * with npm run print:acct-double (you need a .env with Supabase server credentials). It
 * does not call requestRefund and does not add rows to pending_refunds.
 */

import { getAccount, listCharges } from "../lib/accounts";
import { seedAccounts } from "../lib/seed";

const accountId = "acct-double";
const account = await getAccount(accountId);
const charges = await listCharges(accountId);

if (!account) {
  throw new Error(`Account not found: ${accountId}`);
}

const fromAccount = account.charges.map((charge) => charge.chargeId);
const fromList = charges.map((charge) => charge.chargeId);
const expected = seedAccounts.find((row) => row.id === accountId);

if (!expected) {
  throw new Error(`Seed is missing ${accountId}.`);
}

if (fromAccount.join(",") !== fromList.join(",")) {
  throw new Error("getAccount charges did not match listCharges.");
}

if (
  account.plan !== expected.plan ||
  account.customerName !== expected.customerName ||
  JSON.stringify(account.charges) !== JSON.stringify(expected.charges)
) {
  throw new Error("Account from the database did not match the seed shape.");
}

for (const chargeId of fromAccount) {
  console.log(chargeId);
}
