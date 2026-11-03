/**
 * The operator workspace: chat on the left and account context on the right.
 * Chat sends a message to /api/chat and shows the model reply. An eligible
 * preview is held here so the confirm control can post it, and the next
 * successful reply with no eligible preview clears it. Account and Charges
 * show facts from the account route. The pending queue lists refunds waiting
 * for review and can mark one reviewed. Policy citations list the passages
 * search_policy returned for the latest turn. This component does not call
 * Supabase, check a session, decide a refund, call a model, or send money.
 */

"use client";

import { useState } from "react";
import type { ConfirmOffer } from "../lib/confirmOffer";
import type { PolicyPassageView } from "../lib/policyCitations";
import { AccountContext } from "./AccountContext";
import { ChatPanel } from "./ChatPanel";
import { ConfirmRefund } from "./ConfirmRefund";
import { PendingQueue } from "./PendingQueue";
import { PolicyCitations } from "./PolicyCitations";
import { TryThisJourney } from "./TryThisJourney";
import styles from "./Workspace.module.css";

export function Workspace() {
  const [offer, setOffer] = useState<ConfirmOffer | null>(null);
  const [policyPassages, setPolicyPassages] = useState<PolicyPassageView[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Northline Copilot</h1>
      </header>
      <div className={styles.columns}>
        <div className={styles.chat}>
          <ChatPanel
            onConfirmOffer={setOffer}
            onPolicyPassages={setPolicyPassages}
            pendingPrompt={pendingPrompt}
            onPendingPromptApplied={() => setPendingPrompt(null)}
          />
        </div>
        <div className={styles.context} aria-label="Context">
          <TryThisJourney onUseExample={setPendingPrompt} />
          <AccountContext />
          <ConfirmRefund offer={offer} onConsumed={() => setOffer(null)} />
          <PendingQueue />
          <PolicyCitations passages={policyPassages} />
        </div>
      </div>
    </div>
  );
}
