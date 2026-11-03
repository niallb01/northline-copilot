/**
 * Policy citations panel. It lists the best-matching passage from this turn's
 * search_policy result (one section). It does not show document ids, chunk ids, or file
 * paths. It does not search, decide which quote counts, or queue a refund. The server already dropped any
 * quote that did not match one of these passages.
 */

import { plainPolicyText, type PolicyPassageView } from "../lib/policyCitations";
import { Panel } from "./Panel";
import styles from "./PolicyCitations.module.css";

export function PolicyCitations({ passages }: { passages: PolicyPassageView[] }) {
  return (
    <Panel title="Policy citations" scrollBody>
      <div className={styles.panelContent}>
        {passages.length === 0 ? (
          <p className={styles.message}>No policy passage was retrieved for this turn.</p>
        ) : (
          <ol className={styles.list}>
            {passages.map((passage) => (
              <li key={`${passage.documentId}:${passage.chunkId}`} className={styles.row}>
                <p className={styles.text}>{plainPolicyText(passage.text)}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}
