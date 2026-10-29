/**
 * The operator workspace: chat on the left and account context on the right.
 * Chat sends a message to /api/chat and shows the model reply. An eligible
 * preview is held here so the confirm control can post it. Account and Charges
 * show facts from the account route. The pending queue lists refunds waiting
 * for review and can mark one reviewed. Policy citations stay empty. This
 * component does not call Supabase, check a session, decide a refund, call a
 * model, or send money.
 */

"use client";

import { useState } from "react";
import type { ConfirmOffer } from "../lib/confirmOffer";
import { AccountContext } from "./AccountContext";
import { ChatPanel } from "./ChatPanel";
import { ConfirmRefund } from "./ConfirmRefund";
import { Panel } from "./Panel";
import { PendingQueue } from "./PendingQueue";
import styles from "./Workspace.module.css";

export function Workspace() {
  const [offer, setOffer] = useState<ConfirmOffer | null>(null);

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Northline Copilot</h1>
      </header>
      <div className={styles.columns}>
        <div className={styles.chat}>
          <ChatPanel onConfirmOffer={setOffer} />
        </div>
        <div className={styles.context} aria-label="Context">
          <AccountContext />
          <ConfirmRefund offer={offer} onConsumed={() => setOffer(null)} />
          <PendingQueue />
          <Panel title="Policy citations" />
        </div>
      </div>
    </div>
  );
}
