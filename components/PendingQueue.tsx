/**
 * Pending queue panel. The browser asks GET /api/pending-refunds and lists
 * rows still waiting. Mark reviewed posts the account id and charge id to
 * /api/pending-refunds/review and shows the returned status. It reloads when
 * a confirm queues a new row. It does not decide eligibility, send money, or
 * read the session cookie.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import type { PendingRefund } from "../lib/types";
import { Panel } from "./Panel";
import styles from "./PendingQueue.module.css";

type LoadStatus = "loading" | "ready" | "unauthorized" | "error";

function rowKey(row: PendingRefund): string {
  return `${row.accountId}:${row.chargeId}`;
}

function formatPlan(plan: PendingRefund["plan"]): string {
  return plan === "annual" ? "Annual" : "Monthly";
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(amount);
}

function formatChargeDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function isPendingRefund(value: unknown): value is PendingRefund {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.accountId === "string" &&
    typeof row.customerName === "string" &&
    (row.plan === "annual" || row.plan === "monthly") &&
    typeof row.chargeId === "string" &&
    typeof row.invoiceId === "string" &&
    typeof row.amount === "number" &&
    typeof row.chargeDate === "string" &&
    (row.status === "pending" || row.status === "reviewed") &&
    typeof row.reason === "string" &&
    typeof row.startedAt === "string"
  );
}

function noticeFor(status: LoadStatus, message: string | null): string {
  switch (status) {
    case "loading":
      return "Loading pending refunds…";
    case "unauthorized":
      return "Sign in required.";
    case "error":
      return message ?? "Could not load the pending queue.";
    default:
      return "No refunds are waiting for review. To demo a row, run npm run queue:refund-cases in the project folder, then reload this page. Scroll down to the Pending queue panel — Mark reviewed appears on each pending row only.";
  }
}

export function PendingQueue() {
  const [rows, setRows] = useState<PendingRefund[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const busy = useRef(new Set<string>());

  async function load(reason: "mount" | "reload" | "queued" = "reload") {
      const url = "/api/pending-refunds";
      if (process.env.NODE_ENV === "development") {
        console.log("GET /api/pending-refunds", { method: "GET", url, reason });
      }
      try {
        const response = await fetch(url, {
          cache: "no-store",
          headers: { accept: "application/json" },
        });

        if (response.status === 401) {
          setRows([]);
          setStatus("unauthorized");
          setMessage("Sign in required.");
          return;
        }

        if (!response.ok) {
          setRows([]);
          setStatus("error");
          setMessage("Could not load the pending queue.");
          return;
        }

        const body: unknown = await response.json();
        if (!Array.isArray(body) || !body.every(isPendingRefund)) {
          setRows([]);
          setStatus("error");
          setMessage("Could not load the pending queue.");
          return;
        }

        setRows(body);
        setStatus("ready");
        setMessage(null);
        if (process.env.NODE_ENV === "development") {
          console.log("GET /api/pending-refunds response", {
            status: response.status,
            pendingCount: body.filter((row) => row.status === "pending").length,
            rows: body.map((row) => ({
              accountId: row.accountId,
              chargeId: row.chargeId,
              status: row.status,
            })),
          });
        }
      } catch {
        setRows([]);
        setStatus("error");
        setMessage("Could not load the pending queue.");
      }
  }

  useEffect(() => {
    void load("mount");
    function onQueued() {
      if (process.env.NODE_ENV === "development") {
        console.log("Pending queue reload: northline-pending-changed");
      }
      void load("queued");
    }
    window.addEventListener("northline-pending-changed", onQueued);
    return () => window.removeEventListener("northline-pending-changed", onQueued);
  }, []);

  async function markReviewed(row: PendingRefund) {
    if (row.status !== "pending") return;
    const key = rowKey(row);
    if (busy.current.has(key)) return;
    busy.current.add(key);
    setBusyKey(key);
    setMessage(null);

    try {
      const response = await fetch("/api/pending-refunds/review", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          accountId: row.accountId,
          chargeId: row.chargeId,
        }),
      });

      if (response.status === 401) {
        setStatus("unauthorized");
        setMessage("Sign in required.");
        return;
      }

      if (response.status === 404) {
        setMessage("That refund is not waiting for review.");
        return;
      }

      if (!response.ok) {
        setMessage("Could not mark that refund reviewed.");
        return;
      }

      const body: unknown = await response.json();
      if (!isPendingRefund(body) || body.status !== "reviewed") {
        setMessage("Could not mark that refund reviewed.");
        return;
      }

      setRows((current) =>
        current.map((item) =>
          item.accountId === body.accountId &&
          item.chargeId === body.chargeId &&
          item.status === "pending"
            ? body
            : item,
        ),
      );
      setStatus("ready");
    } catch {
      setMessage("Could not mark that refund reviewed.");
    } finally {
      busy.current.delete(key);
      setBusyKey(null);
    }
  }

  const showEmpty = status !== "ready" || rows.length === 0;

  return (
    <Panel title="Pending queue" scrollBody>
      <div className={styles.panelContent}>
        <div className={styles.toolbar}>
          <button
            className={styles.reload}
            type="button"
            disabled={status === "loading"}
            onClick={() => {
              setStatus("loading");
              void load("reload");
            }}
          >
            {status === "loading" ? "Loading…" : "Reload list"}
          </button>
        </div>
        {showEmpty ? (
          <p className={styles.message}>{noticeFor(status, message)}</p>
        ) : (
          <ul className={styles.list}>
            {rows.map((row) => {
              const key = rowKey(row);
              const reviewing = busyKey === key;
              return (
                <li key={key} className={styles.row}>
                  <div className={styles.rowTop}>
                    <span className={styles.customer}>{row.customerName}</span>
                    <span
                      className={
                        row.status === "reviewed"
                          ? `${styles.status} ${styles.reviewed}`
                          : `${styles.status} ${styles.pending}`
                      }
                    >
                      {row.status === "reviewed" ? "Reviewed" : "Pending"}
                    </span>
                  </div>
                  <p className={styles.meta}>
                    {formatMoney(row.amount)} · {formatChargeDate(row.chargeDate)} ·{" "}
                    {formatPlan(row.plan)}
                  </p>
                  <p className={styles.ids}>
                    {row.chargeId} · {row.accountId}
                  </p>
                  <p className={styles.reason}>{row.reason}</p>
                  {row.status === "pending" ? (
                    <button
                      className={styles.button}
                      type="button"
                      disabled={reviewing}
                      onClick={() => {
                        void markReviewed(row);
                      }}
                    >
                      {reviewing ? "Saving…" : "Mark reviewed"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {status === "ready" && rows.length > 0 && message ? (
          <p className={styles.message}>{message}</p>
        ) : null}
      </div>
    </Panel>
  );
}
