/**
 * Queues a refund inside one Postgres transaction. It locks the charge, loads the
 * account, charges, and pending rows, then calls requestRefund. It inserts one pending
 * row only when that function accepts. A unique-index clash on the same charge comes
 * back as already pending and leaves the table unchanged. Refund windows stay in
 * lib/refundRules.ts. This does not send money or mark a row reviewed.
 */

import { DatabaseError, type PoolClient } from "pg";
import { accountNumberFor } from "./accounts";
import { withClient } from "./postgres";
import { requestRefund } from "./refundRules";
import type { Account, Charge, ChargeStatus, PendingRefund, Plan, RefundResult } from "./types";

const PENDING_INDEX = "pending_refunds_one_pending_per_charge_idx";

export type QueueRefundInput = {
  accountId: string;
  chargeId: string;
  /** Local calendar day passed through to requestRefund. Defaults to today. */
  today?: Date;
  now?: Date;
};

export async function queueRefund(input: QueueRefundInput): Promise<RefundResult> {
  return withClient((client) => runQueueRefund(client, input));
}

async function runQueueRefund(client: PoolClient, input: QueueRefundInput): Promise<RefundResult> {
  const { accountId, chargeId } = input;

  try {
    await client.query("begin");
    await client.query("set local lock_timeout = '10s'");
    await client.query("set local statement_timeout = '15s'");

    await client.query(
      "select charge_id from public.charges where charge_id = $1 for update",
      [chargeId],
    );

    const account = await loadAccount(client, accountId);
    const pending = account ? await loadPending(client, account) : [];
    const before = pending.length;
    const result = requestRefund({
      accountId,
      chargeId,
      accounts: account ? [account] : [],
      pending,
      today: input.today,
      now: input.now,
    });

    if (result.started) {
      const added = pending[pending.length - 1];
      if (pending.length !== before + 1 || !isQueuedRow(added, result)) {
        throw new Error("requestRefund accepted but did not append one pending row.");
      }
      await insertPending(client, added);
    }

    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // The connection may already be closed. The insert did not commit.
    }
    if (isPendingConflict(error)) {
      return alreadyPending(accountId, chargeId);
    }
    throw error;
  }
}

async function loadAccount(client: PoolClient, accountId: string): Promise<Account | null> {
  const accountResult = await client.query<{ id: string; plan: string; customer_name: string }>(
    "select id, plan, customer_name from public.accounts where id = $1",
    [accountId],
  );
  const accountRow = accountResult.rows[0];
  if (!accountRow) return null;

  const chargeResult = await client.query<{
    charge_id: string;
    invoice_id: string;
    amount: number;
    date: string;
    status: string;
  }>(
    `select charge_id, invoice_id, amount, date::text as date, status
     from public.charges
     where account_id = $1
     order by charge_id asc`,
    [accountId],
  );

  const id = asString(accountRow.id, "account id");
  return {
    id,
    accountNumber: accountNumberFor(id),
    plan: asPlan(asString(accountRow.plan, "account plan")),
    customerName: asString(accountRow.customer_name, "customer name"),
    charges: chargeResult.rows.map((row) => toCharge(row)),
  };
}

async function loadPending(client: PoolClient, account: Account): Promise<PendingRefund[]> {
  const result = await client.query<{
    charge_id: string;
    invoice_id: string;
    amount: number;
    charge_date: string;
    status: string;
    reason: string;
    started_at: Date | string;
  }>(
    `select charge_id, invoice_id, amount, charge_date::text as charge_date, status, reason, started_at
     from public.pending_refunds
     where account_id = $1 and status = 'pending'
     order by id asc`,
    [account.id],
  );

  return result.rows.map((row) => toPending(row, account));
}

async function insertPending(client: PoolClient, row: PendingRefund): Promise<void> {
  await client.query(
    `insert into public.pending_refunds (
       account_id, charge_id, invoice_id, amount, charge_date, status, reason, started_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      row.accountId,
      row.chargeId,
      row.invoiceId,
      row.amount,
      row.chargeDate,
      row.status,
      row.reason,
      row.startedAt,
    ],
  );
}

function isQueuedRow(row: PendingRefund | undefined, result: RefundResult): row is PendingRefund {
  return (
    row !== undefined &&
    row.accountId === result.accountId &&
    row.chargeId === result.chargeId &&
    row.status === "pending" &&
    result.status === "pending"
  );
}

function isPendingConflict(error: unknown): boolean {
  if (!(error instanceof DatabaseError) || error.code !== "23505") return false;
  if (error.constraint === PENDING_INDEX) return true;
  return error.message.includes(PENDING_INDEX);
}

function alreadyPending(accountId: string, chargeId: string): RefundResult {
  return {
    started: false,
    status: "rejected",
    accountId,
    chargeId,
    reason: "A refund for this charge is already pending. Nothing new was saved.",
  };
}

function toCharge(row: {
  charge_id: string;
  invoice_id: string;
  amount: number;
  date: string;
  status: string;
}): Charge {
  return {
    invoiceId: asString(row.invoice_id, "invoice id"),
    chargeId: asString(row.charge_id, "charge id"),
    amount: asInteger(row.amount, "charge amount"),
    date: asDateString(row.date),
    status: asChargeStatus(asString(row.status, "charge status")),
  };
}

function toPending(
  row: {
    charge_id: string;
    invoice_id: string;
    amount: number;
    charge_date: string;
    status: string;
    reason: string;
    started_at: Date | string;
  },
  account: Account,
): PendingRefund {
  const status = asString(row.status, "pending status");
  if (status !== "pending") {
    throw new Error(`Unexpected pending status from the database: ${status}`);
  }
  return {
    accountId: account.id,
    customerName: account.customerName,
    plan: account.plan,
    chargeId: asString(row.charge_id, "charge id"),
    invoiceId: asString(row.invoice_id, "invoice id"),
    amount: asInteger(row.amount, "pending amount"),
    chargeDate: asDateString(row.charge_date),
    status: "pending",
    reason: asString(row.reason, "pending reason"),
    startedAt: asStartedAt(row.started_at),
  };
}

function asString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`${label} from the database was not a string.`);
}

function asInteger(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  throw new Error(`${label} from the database was not an integer.`);
}

function asDateString(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  throw new Error("Date from the database was not a YYYY-MM-DD string.");
}

function asStartedAt(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Pending started_at from the database was not a timestamp.");
  }
  return date.toISOString();
}

function asPlan(value: string): Plan {
  if (value === "annual" || value === "monthly") return value;
  throw new Error(`Unexpected plan from the database: ${value}`);
}

function asChargeStatus(value: string): ChargeStatus {
  if (value === "succeeded" || value === "failed" || value === "refunded") return value;
  throw new Error(`Unexpected charge status from the database: ${value}`);
}
