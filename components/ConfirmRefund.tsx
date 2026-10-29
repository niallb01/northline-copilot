/**
 * Confirm control on the workspace. When the chat route has stored an eligible
 * proposal, this panel posts that account id, charge id, and action to
 * /api/refunds/confirm. It does not send a confirmed flag, read the proposal
 * cookie, decide eligibility, or send money. A rejected preview leaves this
 * control without a button.
 */

"use client";

import { useRef, useState } from "react";
import {
  REFUND_NOT_STARTED,
  REFUND_QUEUED,
  type ConfirmOffer,
} from "../lib/confirmOffer";
import { Panel } from "./Panel";
import styles from "./ConfirmRefund.module.css";

const CONFIRM_URL = "/api/refunds/confirm";

export function ConfirmRefund({
  offer,
  onConsumed,
}: {
  offer: ConfirmOffer | null;
  onConsumed: () => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [tone, setTone] = useState<"plain" | "rejected">("plain");
  const [confirming, setConfirming] = useState(false);
  const busy = useRef(false);
  const offerKey = offer ? `${offer.accountId}:${offer.chargeId}` : null;
  const [seenOffer, setSeenOffer] = useState<string | null>(offerKey);
  if (offerKey !== seenOffer) {
    setSeenOffer(offerKey);
    if (offerKey) {
      setNote(null);
      setDetail(null);
    }
  }

  async function confirm() {
    if (!offer || busy.current) return;
    busy.current = true;
    setConfirming(true);
    setNote(null);
    setDetail(null);

    const payload = {
      accountId: offer.accountId,
      chargeId: offer.chargeId,
      action: offer.action,
    };

    try {
      if (process.env.NODE_ENV === "development") {
        console.log("POST /api/refunds/confirm", {
          method: "POST",
          url: CONFIRM_URL,
          body: payload,
        });
      }

      const response = await fetch(CONFIRM_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json().catch(() => null);

      if (process.env.NODE_ENV === "development") {
        console.log("POST /api/refunds/confirm response", {
          status: response.status,
          body,
        });
      }

      if (response.status === 401) {
        setTone("rejected");
        setNote("Sign in required.");
        return;
      }

      const outcome = readOutcome(body);
      if (response.ok && outcome === "queued") {
        if (process.env.NODE_ENV === "development") {
          console.log("Refund added to pending queue:", {
            accountId: offer.accountId,
            chargeId: offer.chargeId,
          });
          console.log("northline-pending-changed dispatched (reload pending queue)");
        }
        setTone("plain");
        setNote(REFUND_QUEUED);
        setDetail(null);
        onConsumed();
        window.dispatchEvent(new Event("northline-pending-changed"));
        return;
      }

      if (response.ok && outcome === "not_started") {
        if (process.env.NODE_ENV === "development") {
          console.log("Confirm finished but refund was not started:", {
            accountId: offer.accountId,
            chargeId: offer.chargeId,
            reason: readReason(body),
          });
        }
        setTone("rejected");
        setNote(REFUND_NOT_STARTED);
        setDetail(readReason(body));
        onConsumed();
        return;
      }

      setTone("rejected");
      setNote(readError(body));
      if (response.status === 403) onConsumed();
    } catch {
      setTone("rejected");
      setNote("Could not confirm that refund.");
    } finally {
      busy.current = false;
      setConfirming(false);
    }
  }

  return (
    <Panel title="Confirm refund">
      <div className={styles.panelContent}>
        {offer ? (
          <>
            <p className={styles.lead}>
              Queue a pending refund for this charge. This does not send money.
            </p>
            <p className={styles.ids}>
              {offer.accountId} · {offer.chargeId}
            </p>
            <button
              className={styles.button}
              type="button"
              disabled={confirming}
              onClick={() => {
                void confirm();
              }}
            >
              {confirming ? "Confirming…" : "Confirm refund"}
            </button>
          </>
        ) : (
          <p className={styles.lead}>No refund is waiting for you to confirm.</p>
        )}
        {note ? (
          <p className={tone === "rejected" ? styles.rejected : styles.note} role="status">
            {note}
          </p>
        ) : null}
        {detail ? <p className={styles.detail}>{detail}</p> : null}
      </div>
    </Panel>
  );
}

function readOutcome(body: unknown): "queued" | "not_started" | null {
  if (typeof body !== "object" || body === null) return null;
  const row = body as Record<string, unknown>;
  if (row.started === true && row.status === "pending") return "queued";
  if (row.started === false && row.status === "rejected") return "not_started";
  return null;
}

function readReason(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const reason = (body as { reason?: unknown }).reason;
  if (typeof reason !== "string") return null;
  const text = reason.trim();
  if (!text || text.length > 500 || text.includes("\n")) return null;
  return text;
}

function readError(body: unknown): string {
  if (typeof body !== "object" || body === null) return "Could not confirm that refund.";
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "string") return "Could not confirm that refund.";
  const text = error.trim();
  if (!text || text.length > 300 || text.includes("\n")) return "Could not confirm that refund.";
  return text;
}
