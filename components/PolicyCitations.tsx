/**
 * Policy citations panel. It lists each passage from this turn's search_policy
 * result: document id, chunk id, path, and the stored text. It does not search,
 * decide which quote counts, or queue a refund. The server already dropped any
 * quote that did not match one of these passages.
 */

import type { PolicyPassageView } from "../lib/policyCitations";
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
                <p className={styles.meta}>
                  <span className={styles.label}>Document</span> {passage.documentId}
                </p>
                <p className={styles.meta}>
                  <span className={styles.label}>Chunk</span> {passage.chunkId}
                </p>
                <p className={styles.path}>
                  <span className={styles.label}>Path</span>{" "}
                  <code className={styles.code}>{passage.path}</code>
                </p>
                <p className={styles.text}>{passage.text}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}
