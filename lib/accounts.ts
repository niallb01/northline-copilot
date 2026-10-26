/**
 * Loads Northline customers from the database for the server. Call getAccount with an
 * account id to get that customer’s plan, name, and every charge on the account, or null
 * if the id does not exist. Call listCharges when you only need the charge lines for one
 * account. Results use the same field names as lib/types.ts (for example chargeId, not
 * charge_id). Nothing here starts a refund or writes to pending_refunds.
 */

import { seedAccounts } from "./seed";
import { getServerSupabase } from "./supabase";
import type { Account, Charge, ChargeStatus, Plan } from "./types";

export async function getAccount(accountKey: string): Promise<Account | null> {
  const trimmed = accountKey.trim();
  if (!trimmed) return null;

  const resolvedId = resolveAccountId(trimmed);
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, plan, customer_name")
    .eq("id", resolvedId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read account: ${error.message}`);
  }

  if (!data) return null;

  const row = parseAccountRow(data);
  const charges = await listCharges(row.id);

  return {
    id: row.id,
    accountNumber: accountNumberFor(row.id),
    plan: asPlan(row.plan),
    customerName: row.customer_name,
    charges,
  };
}

export function resolveAccountId(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return trimmed;

  const upper = trimmed.toUpperCase();
  const asAccountNumber = upper.startsWith("NL-") ? upper : /^\d+$/.test(upper) ? `NL-${upper}` : upper;
  const fromNumber = seedAccounts.find(
    (account) => account.accountNumber.toUpperCase() === asAccountNumber,
  );
  if (fromNumber) return fromNumber.id;

  const fromId = seedAccounts.find((account) => account.id === trimmed);
  if (fromId) return fromId.id;

  const lower = trimmed.toLowerCase();
  const exactName = seedAccounts.filter(
    (account) => account.customerName.toLowerCase() === lower,
  );
  if (exactName.length === 1) return exactName[0].id;

  const partialName = seedAccounts.filter((account) =>
    account.customerName.toLowerCase().includes(lower),
  );
  if (partialName.length === 1) return partialName[0].id;

  return trimmed;
}

export function accountNumberFor(accountId: string): string {
  return seedAccounts.find((account) => account.id === accountId)?.accountNumber ?? accountId;
}

export async function listCharges(accountId: string): Promise<Charge[]> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("charges")
    .select("charge_id, invoice_id, amount, date, status")
    .eq("account_id", accountId)
    .order("charge_id", { ascending: true });

  if (error) {
    throw new Error(`Could not list charges: ${error.message}`);
  }

  return (data ?? []).map((row) => toCharge(row));
}

function parseAccountRow(value: unknown): { id: string; plan: string; customer_name: string } {
  const row = asRecord(value, "Account row");
  const id = asString(row.id, "account id");
  const plan = asString(row.plan, "account plan");
  const customer_name = asString(row.customer_name, "customer name");
  return { id, plan, customer_name };
}

function toCharge(value: unknown): Charge {
  const row = asRecord(value, "Charge row");
  return {
    invoiceId: asString(row.invoice_id, "invoice id"),
    chargeId: asString(row.charge_id, "charge id"),
    amount: asInteger(row.amount, "charge amount"),
    date: asDateString(row.date),
    status: asChargeStatus(asString(row.status, "charge status")),
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  throw new Error(`${label} from the database was not an object.`);
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
  throw new Error("Charge date from the database was not a YYYY-MM-DD string.");
}

function asPlan(value: string): Plan {
  if (value === "annual" || value === "monthly") return value;
  throw new Error(`Unexpected plan from the database: ${value}`);
}

function asChargeStatus(value: string): ChargeStatus {
  if (value === "succeeded" || value === "failed" || value === "refunded") return value;
  throw new Error(`Unexpected charge status from the database: ${value}`);
}
