/**
 * Manual check for M18b. It searches “crypto refund”, a topic the policy files
 * do not cover, and stops unless the result is an empty passage list and the
 * message that the policy does not contain this. It does not call the chat
 * model, invent a refund rule, or change the UI.
 */

import { POLICY_MISS_MESSAGE, searchPolicy } from "../lib/policy";
import { closePool } from "../lib/postgres";

const query = "crypto refund";

try {
  const result = await searchPolicy(query);
  console.log(`query: ${query}`);
  console.log(`passages: ${result.passages.length}`);
  if (result.message) {
    console.log(result.message);
  }

  if (result.passages.length !== 0) {
    throw new Error("Expected no passage for a topic the policy files do not cover.");
  }
  if (result.message !== POLICY_MISS_MESSAGE) {
    throw new Error("Expected the policy-does-not-contain message.");
  }
} finally {
  await closePool();
}
