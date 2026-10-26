/**
 * The operator workspace: chat on the left and account context on the right.
 * Account and Charges show facts from the account route. The pending queue
 * lists refunds waiting for review and can mark one reviewed. Chat and policy
 * citations stay empty. This component does not call Supabase, check a session,
 * decide a refund, or send money.
 */

import { AccountContext } from "./AccountContext";
import { Panel } from "./Panel";
import { PendingQueue } from "./PendingQueue";
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
          <PendingQueue />
          <Panel title="Policy citations" />
        </div>
      </div>
    </div>
  );
}
