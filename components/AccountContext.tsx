/**
 * Account and Charges panels for one id the operator types or selects. The
 * browser asks GET /api/accounts/[accountId] and renders the facts that come
 * back: name, plan, and charge lines. It does not decide a refund, queue a
 * pending row, or read the session cookie.
 */

"use client";

import { useState, type FormEvent } from "react";
import { seedAccounts } from "../lib/seed";
import type { Account, Charge, ChargeStatus } from "../lib/types";
import { Panel } from "./Panel";
import styles from "./AccountContext.module.css";

type LoadStatus = "idle" | "loading" | "ready" | "missing" | "unauthorized" | "error";

function demoCustomerHint(demo: Account): string {
  const oneInvoice = demo.charges.every((charge) => charge.invoiceId === demo.charges[0]?.invoiceId);
  if (demo.charges.length > 1 && oneInvoice) {
    return "Duplicate billing (demo)";
  }
  return `${formatPlan(demo.plan)} plan`;
}

function formatPlan(plan: Account["plan"]): string {
  return plan === "annual" ? "Annual" : "Monthly";
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function formatChargeDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function chargeStatusLabel(status: ChargeStatus): string {
  if (status === "succeeded") return "Paid";
  if (status === "failed") return "Failed";
  return "Refunded";
}

function sameInvoiceNote(charge: Charge, allCharges: Charge[]): string | null {
  const onSameInvoice = allCharges.filter((row) => row.invoiceId === charge.invoiceId);
  if (onSameInvoice.length <= 1) return null;
  const index = onSameInvoice.findIndex((row) => row.chargeId === charge.chargeId) + 1;
  return `${index} of ${onSameInvoice.length} on the same invoice`;
}

function ChargeRow({ charge, allCharges }: { charge: Charge; allCharges: Charge[] }) {
  const note = sameInvoiceNote(charge, allCharges);
  const statusClass =
    charge.status === "succeeded"
      ? styles.chargePaid
      : charge.status === "failed"
        ? styles.chargeFailed
        : styles.chargeRefunded;

  return (
    <li className={styles.charge}>
      <div className={styles.chargeMain}>
        <span className={styles.chargeAmount}>{formatMoney(charge.amount)}</span>
        <span className={styles.chargeDate}>{formatChargeDate(charge.date)}</span>
        <span className={`${styles.chargeStatus} ${statusClass}`}>{chargeStatusLabel(charge.status)}</span>
      </div>
      {note ? <p className={styles.chargeNote}>{note}</p> : null}
    </li>
  );
}

function noticeForAccount(status: LoadStatus, message: string | null): string {
  switch (status) {
    case "loading":
      return "Loading account…";
    case "missing":
      return "No customer matched that search.";
    case "unauthorized":
      return "Sign in required.";
    case "error":
      return message ?? "Could not load that account.";
    default:
      return "Search for a customer or open one from the demo list.";
  }
}

function noticeForCharges(status: LoadStatus, message: string | null): string {
  switch (status) {
    case "loading":
      return "Loading charges…";
    case "missing":
      return "No charges to show.";
    case "unauthorized":
      return "Sign in required.";
    case "error":
      return message ?? "Could not load charges.";
    default:
      return "Charges for the account you look up will show here.";
  }
}

function isAccount(value: unknown): value is Account {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.accountNumber !== "string" ||
    typeof row.customerName !== "string"
  ) {
    return false;
  }
  if (row.plan !== "annual" && row.plan !== "monthly") return false;
  if (!Array.isArray(row.charges)) return false;
  return row.charges.every(isCharge);
}

function isCharge(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.chargeId === "string" &&
    typeof line.invoiceId === "string" &&
    typeof line.amount === "number" &&
    typeof line.date === "string" &&
    (line.status === "succeeded" || line.status === "failed" || line.status === "refunded")
  );
}

export function AccountContext() {
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function searchAccount(searchText: string) {
    const trimmed = searchText.trim();
    if (!trimmed) {
      setAccount(null);
      setStatus("error");
      setMessage("Enter a customer name or acc number.");
      return;
    }

    setStatus("loading");
    setMessage(null);

    try {
      const response = await fetch(`/api/accounts/${encodeURIComponent(trimmed)}`, {
        headers: { accept: "application/json" },
      });

      if (response.status === 401) {
        setAccount(null);
        setStatus("unauthorized");
        setMessage("Sign in required.");
        return;
      }

      if (response.status === 404) {
        setAccount(null);
        setStatus("missing");
        setMessage("No customer matched that search.");
        return;
      }

      if (!response.ok) {
        setAccount(null);
        setStatus("error");
        setMessage("Could not load that account.");
        return;
      }

      const body: unknown = await response.json();
      if (!isAccount(body)) {
        setAccount(null);
        setStatus("error");
        setMessage("Could not load that account.");
        return;
      }

      setAccount(body);
      setStatus("ready");
    } catch {
      setAccount(null);
      setStatus("error");
      setMessage("Could not load that account.");
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void searchAccount(query);
  }

  const accountNotice = noticeForAccount(status, message);
  const chargesNotice = noticeForCharges(status, message);

  return (
    <>
      <Panel title="Account">
        <div className={styles.panelContent}>
          <form className={styles.form} onSubmit={onSubmit}>
            <label className={styles.label} htmlFor="account-search">
              Search
            </label>
            <div className={styles.lookupRow}>
              <input
                className={styles.input}
                id="account-search"
                name="query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Customer name or acc #"
                autoComplete="off"
                spellCheck={false}
              />
              <button className={styles.button} type="submit" disabled={status === "loading"}>
                {status === "loading" ? "Searching…" : "Search"}
              </button>
            </div>
            <div className={styles.demoBlock}>
              <p className={styles.demoHint}>Demo customers</p>
              <ul className={styles.demoList}>
                {seedAccounts.map((demo) => (
                  <li key={demo.id}>
                    <button
                      className={styles.demoRow}
                      type="button"
                      aria-pressed={account?.id === demo.id}
                      onClick={() => {
                        setQuery(demo.customerName);
                        void searchAccount(demo.customerName);
                      }}
                    >
                      <span className={styles.demoRowTop}>
                        <span className={styles.demoName}>{demo.customerName}</span>
                        <span className={styles.demoAcc}>{demo.accountNumber}</span>
                      </span>
                      <span className={styles.demoMeta}>{demoCustomerHint(demo)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </form>
          {status === "ready" && account ? (
            <dl className={styles.facts}>
              <dt>Acc</dt>
              <dd>{account.accountNumber}</dd>
              <dt>Customer</dt>
              <dd>{account.customerName}</dd>
              <dt>Plan</dt>
              <dd>{formatPlan(account.plan)}</dd>
            </dl>
          ) : (
            <p className={styles.message}>{accountNotice}</p>
          )}
        </div>
      </Panel>
      <Panel title="Charges">
        <div className={styles.panelContent}>
          {status === "ready" && account ? (
            account.charges.length === 0 ? (
              <p className={styles.message}>This account has no charges.</p>
            ) : (
              <ul className={styles.charges}>
                {account.charges.map((charge) => (
                  <ChargeRow key={charge.chargeId} charge={charge} allCharges={account.charges} />
                ))}
              </ul>
            )
          ) : (
            <p className={styles.message}>{chargesNotice}</p>
          )}
        </div>
      </Panel>
    </>
  );
}
