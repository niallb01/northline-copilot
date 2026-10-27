/**
 * The operator workspace: chat on the left and account context on the right.
 * Chat sends a message to /api/chat and shows the model reply in the transcript.
 * Account and Charges show facts from the account route. The pending queue
 * lists refunds waiting for review and can mark one reviewed. Policy citations
 * stay empty. This component does not call Supabase, check a session, decide
 * a refund, call a model, or send money.
 */

import { AccountContext } from "./AccountContext";
import { ChatPanel } from "./ChatPanel";
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
          <ChatPanel />
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
