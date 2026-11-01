/**
 * Fills policy_chunks.embedding from each stored passage. Run it with
 * npm run embed:policy after the M18a migration. It does not search, write a
 * sentence, or change pending refunds.
 */

import { embedPolicyChunks } from "../lib/policy";
import { closePool } from "../lib/postgres";

try {
  const count = await embedPolicyChunks();
  console.log(`embedded ${count} policy chunks`);
} finally {
  await closePool();
}
