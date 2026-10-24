/**
 * The operator workspace: chat on the left and account context on the right.
 * Every panel is an empty label. This component does not read Supabase, call a
 * model, check a session, or queue a refund.
 */

import { Panel } from "./Panel";
import styles from "./Workspace.module.css";

export function Workspace() {
  console.log("Workspace component is rendering.");
  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Northline Copilot</h1>
      </header>
      <div className={styles.columns}>
        <div className={styles.chat}>
          <Panel title="Chat" fill />
        </div>
        <div className={styles.context} aria-label="Context">
          <Panel title="Account" />
          <Panel title="Charges" />
          <Panel title="Policy citations" />
          <Panel title="Pending queue" />
        </div>
      </div>
    </div>
  );
}
