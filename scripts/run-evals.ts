/**
 * Runs the M25 scorecard and prints pass or fail for every case, then one
 * sample token total from a chat turn in that run. It does not print an
 * accuracy percentage. Pending rows for the story charges are cleared before
 * and after. This script does not deploy, confirm a refund, or send money.
 */

import { closePool } from "../lib/postgres";
import { runScorecard } from "../tests/evals/scorecard";

let exitCode = 1;

try {
  const report = await runScorecard();
  const passed = report.rows.filter((row) => row.pass).length;
  const failed = report.rows.length - passed;
  console.log("---");
  console.log(`${report.rows.length} cases`);
  console.log(`pass ${passed}`);
  console.log(`fail ${failed}`);
  if (report.tokenSample) {
    const sample = report.tokenSample;
    console.log(
      `sample token total from ${sample.caseId}: ${sample.promptTokens} prompt, ${sample.completionTokens} completion, ${sample.totalTokens} total`,
    );
  } else {
    console.log("sample token total: none. No chat turn in this run returned usage.");
  }
  exitCode = failed > 0 ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  await closePool();
}

process.exitCode = exitCode;
