/**
 * Short in-app walkthrough for portfolio visitors. It lists three steps and
 * offers example chat prompts they can paste into the composer. It does not
 * load an account, call the model, or queue a refund.
 */

import { Panel } from "./Panel";
import styles from "./TryThisJourney.module.css";

export const TRY_REFUND_PROMPT =
  "Tom Ellis wants a refund on his September charge — are we allowed?";

export const TRY_POLICY_PROMPT = "What's the monthly plan refund window?";

export function TryThisJourney({
  onUseExample,
}: {
  onUseExample: (message: string) => void;
}) {
  return (
    <Panel title="Try this demo">
      <div className={styles.content}>
        <p className={styles.lead}>
          About one minute. You do not need internal account or charge ids in chat.
        </p>
        <ol className={styles.steps}>
          <li>
            Under <strong>Demo customers</strong> below, click <strong>Tom Ellis</strong> (monthly
            plan, September charge).
          </li>
          <li>
            Ask whether his September refund is allowed.
            <button
              className={styles.exampleButton}
              type="button"
              onClick={() => onUseExample(TRY_REFUND_PROMPT)}
            >
              Use example question
            </button>
          </li>
          <li>
            Ask about the monthly refund window.
            <button
              className={styles.exampleButton}
              type="button"
              onClick={() => onUseExample(TRY_POLICY_PROMPT)}
            >
              Use example question
            </button>
          </li>
        </ol>
        <p className={styles.outcome}>
          Expect a <strong>rejected</strong> refund preview, a <strong>cited</strong> policy
          answer, and an empty pending queue. Eligibility is decided in code, not by the model
          alone.
        </p>
      </div>
    </Panel>
  );
}
