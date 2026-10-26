/**
 * The operator workspace: chat on the left and account context on the right.
 * Account and Charges show facts from the account route. Chat, policy
 * citations, and the pending queue stay empty. This component does not call
 * Supabase, check a session, decide a refund, or queue one.
 */

import { AccountContext } from "./AccountContext";
import { Panel } from "./Panel";
import styles from "./Workspace.module.css";

export function Workspace() {
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
          <AccountContext />
          <Panel title="Policy citations" />
          <Panel title="Pending queue" />
        </div>
      </div>
    </div>
  );
}
