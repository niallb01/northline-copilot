/**
 * Runs one named tool on the server: check the arguments, call the matching
 * function in lib/, and return a JSON result. get_account calls getAccount.
 * list_charges calls listCharges after that same lookup, so a missing account
 * is a clear not-found error rather than an empty list. This file does not
 * call OpenAI, stream a reply, decide a refund, or write a pending row.
 */

import { getAccount, listCharges } from "./accounts";
import type { Account, Charge } from "./types";

export const ACCOUNT_NOT_FOUND = "No account with that id.";

export type ToolReaders = {
  getAccount: (accountKey: string) => Promise<Account | null>;
  listCharges: (accountId: string) => Promise<Charge[]>;
};

export type ToolResult =
  | { ok: true; tool: "get_account"; result: Account }
  | { ok: true; tool: "list_charges"; result: Charge[] }
  | { ok: false; tool: string; error: string };

const defaultReaders: ToolReaders = { getAccount, listCharges };

export async function dispatchTool(
  name: unknown,
  args: unknown,
  readers: ToolReaders = defaultReaders,
): Promise<ToolResult> {
  const tool = typeof name === "string" ? name.trim() : "";
  if (tool !== "get_account" && tool !== "list_charges") {
    return { ok: false, tool: safeToolLabel(tool), error: "Unknown tool." };
  }

  const accountId = readAccountId(args);
  if (typeof accountId !== "string") {
    return { ok: false, tool, error: accountId.error };
  }

  try {
    if (tool === "get_account") {
      const account = await readers.getAccount(accountId);
      if (!account) return { ok: false, tool, error: ACCOUNT_NOT_FOUND };
      return { ok: true, tool, result: account };
    }

    const account = await readers.getAccount(accountId);
    if (!account) return { ok: false, tool, error: ACCOUNT_NOT_FOUND };
    const charges = await readers.listCharges(account.id);
    return { ok: true, tool, result: charges };
  } catch (error) {
    return { ok: false, tool, error: plainFailure(tool, error) };
  }
}

function readAccountId(args: unknown): string | { error: string } {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return { error: "Tool arguments must be an object." };
  }

  const value = (args as Record<string, unknown>).account_id;
  if (typeof value !== "string") {
    return { error: "account_id must be a string." };
  }

  const accountId = value.trim();
  if (!accountId) return { error: "account_id is required." };
  if (accountId.length > 80) return { error: "account_id is too long." };
  return accountId;
}

function safeToolLabel(tool: string): string {
  return /^[a-z_][a-z0-9_]{0,40}$/.test(tool) ? tool : "";
}

function plainFailure(tool: string, error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message && message.length <= 300 && !message.includes("\n") && !message.includes("    at ")) {
      return message;
    }
  }
  return `Could not run ${tool}.`;
}
