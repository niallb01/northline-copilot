/**
 * Runs one named tool on the server: check the arguments, call the matching
 * function in lib/, and return a JSON result. Every call writes one audit row
 * with the tool name, the arguments, the outcome, and pending_row_created.
 * Stored arguments omit API keys and raw secrets. get_account calls getAccount.
 * list_charges calls listCharges after that same lookup, so a missing account
 * is a clear not-found error rather than an empty list. preview_refund calls
 * previewRefund, which uses the refund rules and appends nothing. search_policy
 * calls searchPolicy and returns stored passages or a miss message.
 * request_refund is not a tool: that call is logged as a rejection and does not
 * insert a pending row. This file does not call OpenAI for chat, stream a reply,
 * call queueRefund, or insert a pending row. pending_row_created is false.
 * The tool result has no confirmation token.
 */

import { getAccount, listCharges } from "./accounts";
import {
  sanitizeAuditArguments,
  toolNameForAudit,
  writeAuditLog,
  type AuditWriter,
} from "./audit";
import { searchPolicy, type PolicySearchResult } from "./policy";
import { listPendingForAccount } from "./refunds";
import { previewRefund } from "./refundRules";
import type { Account, Charge, PendingRefund } from "./types";

export const ACCOUNT_NOT_FOUND = "No account with that id.";

export type ToolReaders = {
  getAccount: (accountKey: string) => Promise<Account | null>;
  listCharges: (accountId: string) => Promise<Charge[]>;
  listPending: (accountId: string) => Promise<PendingRefund[]>;
};

export type PreviewRefundResult = {
  status: "pending" | "rejected";
  reason: string;
  accountId: string;
  chargeId: string;
};

export type ToolResult =
  | { ok: true; tool: "get_account"; result: Account }
  | { ok: true; tool: "list_charges"; result: Charge[] }
  | { ok: true; tool: "preview_refund"; result: PreviewRefundResult }
  | { ok: true; tool: "search_policy"; result: PolicySearchResult }
  | { ok: false; tool: string; error: string };

export type EligibleProposal = {
  accountId: string;
  chargeId: string;
  action: "request_refund";
};

export type DispatchContext = {
  today?: Date;
  now?: Date;
};

const defaultReaders: ToolReaders = {
  getAccount,
  listCharges,
  listPending: listPendingForAccount,
};

export function eligibleProposal(result: ToolResult): EligibleProposal | null {
  if (!result.ok || result.tool !== "preview_refund") return null;
  if (result.result.status !== "pending") return null;
  return {
    accountId: result.result.accountId,
    chargeId: result.result.chargeId,
    action: "request_refund",
  };
}

export async function dispatchTool(
  name: unknown,
  args: unknown,
  readers: ToolReaders = defaultReaders,
  context: DispatchContext = {},
  writeAudit: AuditWriter = writeAuditLog,
): Promise<ToolResult> {
  const result = await executeTool(name, args, readers, context);
  await writeAudit({
    toolName: toolNameForAudit(result.tool),
    arguments: sanitizeAuditArguments(args),
    outcome: sanitizeAuditArguments(result),
    pendingRowCreated: false,
  });
  return result;
}

async function executeTool(
  name: unknown,
  args: unknown,
  readers: ToolReaders,
  context: DispatchContext,
): Promise<ToolResult> {
  const tool = typeof name === "string" ? name.trim() : "";
  if (
    tool !== "get_account" &&
    tool !== "list_charges" &&
    tool !== "preview_refund" &&
    tool !== "search_policy"
  ) {
    return { ok: false, tool: safeToolLabel(tool), error: "Unknown tool." };
  }

  if (tool === "preview_refund") {
    return runPreview(args, readers, context);
  }

  if (tool === "search_policy") {
    return runSearchPolicy(args);
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

async function runSearchPolicy(args: unknown): Promise<ToolResult> {
  const tool = "search_policy";
  const parsed = readPolicyQuery(args);
  if ("error" in parsed) return { ok: false, tool, error: parsed.error };

  if (process.env.NODE_ENV === "development") {
    console.log("search_policy called:", { query: parsed.query });
  }

  try {
    const result = await searchPolicy(parsed.query);
    if (process.env.NODE_ENV === "development") {
      console.log("search_policy result:", {
        passages: result.passages.length,
        message: result.message,
        top: result.passages[0]
          ? `${result.passages[0].documentId} / ${result.passages[0].chunkId}`
          : null,
      });
    }
    return { ok: true, tool, result };
  } catch (error) {
    const failure = { ok: false as const, tool, error: plainFailure(tool, error) };
    if (process.env.NODE_ENV === "development") {
      console.log("search_policy result:", failure);
    }
    return failure;
  }
}

async function runPreview(
  args: unknown,
  readers: ToolReaders,
  context: DispatchContext,
): Promise<ToolResult> {
  const tool = "preview_refund";
  const parsed = readPreviewArgs(args);
  if ("error" in parsed) return { ok: false, tool, error: parsed.error };

  if (process.env.NODE_ENV === "development") {
    console.log("preview_refund called:", {
      account_id: parsed.accountId,
      charge_id: parsed.chargeId,
    });
  }

  try {
    const account = await readers.getAccount(parsed.accountId);
    if (!account) {
      const failure = { ok: false as const, tool, error: ACCOUNT_NOT_FOUND };
      if (process.env.NODE_ENV === "development") {
        console.log("preview_refund result:", failure);
      }
      return failure;
    }

    const stored = await readers.listPending(account.id);
    const pending = stored.map((row) => ({ ...row }));
    const decision = previewRefund({
      accountId: account.id,
      chargeId: parsed.chargeId,
      accounts: [account],
      pending,
      today: context.today,
      now: context.now,
    });
    if (pending.length !== stored.length) {
      const failure = { ok: false as const, tool, error: "Could not run preview_refund." };
      if (process.env.NODE_ENV === "development") {
        console.log("preview_refund result:", failure);
      }
      return failure;
    }

    const success = {
      ok: true as const,
      tool: "preview_refund" as const,
      result: {
        status: decision.status,
        reason: decision.reason,
        accountId: decision.accountId,
        chargeId: decision.chargeId,
      },
    };
    if (process.env.NODE_ENV === "development") {
      console.log("preview_refund result:", {
        status: success.result.status,
        account_id: success.result.accountId,
        charge_id: success.result.chargeId,
      });
    }
    return success;
  } catch (error) {
    const failure = { ok: false as const, tool, error: plainFailure(tool, error) };
    if (process.env.NODE_ENV === "development") {
      console.log("preview_refund result:", failure);
    }
    return failure;
  }
}

function readAccountId(args: unknown): string | { error: string } {
  if (!isArgsObject(args)) return { error: "Tool arguments must be an object." };
  return readIdValue(args.account_id, "account_id");
}

function readPolicyQuery(args: unknown): { query: string } | { error: string } {
  if (!isArgsObject(args)) return { error: "Tool arguments must be an object." };
  const queryValue = args.query;
  if (typeof queryValue !== "string") return { error: "query must be a string." };
  const query = queryValue.trim();
  if (!query) return { error: "query is required." };
  if (query.length > 500) return { error: "query is too long." };
  return { query };
}

function readPreviewArgs(
  args: unknown,
): { accountId: string; chargeId: string } | { error: string } {
  if (!isArgsObject(args)) return { error: "Tool arguments must be an object." };

  const accountId = readIdValue(args.account_id, "account_id");
  if (typeof accountId !== "string") return accountId;
  const chargeId = readIdValue(args.charge_id, "charge_id");
  if (typeof chargeId !== "string") return chargeId;
  return { accountId, chargeId };
}

function isArgsObject(args: unknown): args is Record<string, unknown> {
  return typeof args === "object" && args !== null && !Array.isArray(args);
}

function readIdValue(value: unknown, field: string): string | { error: string } {
  if (typeof value !== "string") return { error: `${field} must be a string.` };
  const id = value.trim();
  if (!id) return { error: `${field} is required.` };
  if (id.length > 80) return { error: `${field} is too long.` };
  return id;
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
