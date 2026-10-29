/**
 * Runs one named tool on the server: check the arguments, call the matching
 * function in lib/, and return a JSON result. get_account calls getAccount.
 * list_charges calls listCharges after that same lookup, so a missing account
 * is a clear not-found error rather than an empty list. preview_refund calls
 * previewRefund, which uses the refund rules and appends nothing. This file
 * does not call OpenAI, stream a reply, call queueRefund, or insert a pending
 * row. The tool result has no confirmation token.
 */

import { getAccount, listCharges } from "./accounts";
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
): Promise<ToolResult> {
  const tool = typeof name === "string" ? name.trim() : "";
  if (tool !== "get_account" && tool !== "list_charges" && tool !== "preview_refund") {
    return { ok: false, tool: safeToolLabel(tool), error: "Unknown tool." };
  }

  if (tool === "preview_refund") {
    return runPreview(args, readers, context);
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
      tool,
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
