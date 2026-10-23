/**
 * Reads acct-double from Postgres and prints its charge ids, one per line.
 * This checks the read path only. It does not call the refund rules or write a pending row.
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
