/**
 * Decides whether a human confirm may call queueRefund. The call is allowed
 * only when the demo session is valid, the HttpOnly proposal is present,
 * unexpired, and unused, and this request names the same account, charge, and
 * action. A confirmed flag is not read here. This file does not set cookies,
 * talk to a model, or send money. The route clears the proposal cookie after
 * a matching confirm.
 */

import { createHash } from "node:crypto";
import { REFUND_NOT_STARTED, REFUND_QUEUED } from "./confirmOffer";
import { readProposal } from "./proposal";
import { queueRefund as queueRefundService, type QueueRefundInput } from "./refunds";
import { verifySession } from "./session";
import type { RefundResult } from "./types";

const usedProposals = new Set<string>();

export type ConfirmRefundInput = {
  sessionToken: string | undefined;
  proposalToken: string | undefined;
  accountId: string;
  chargeId: string;
  action: string;
  /** Milliseconds, same clock as signSession and signProposal. */
  now?: number;
};

export type ConfirmRefundResult =
  | {
      ok: true;
      status: 200;
      started: boolean;
      refund: RefundResult;
      clearProposal: true;
    }
  | {
      ok: false;
      status: 401 | 403;
      error: string;
      clearProposal: boolean;
    };

type QueueFn = (input: QueueRefundInput) => Promise<RefundResult>;

/**
 * Reads the confirm POST body. Ignores confirmed, approved, and any token
 * field. Those cannot authorise a refund.
 */
export function readConfirmRequest(
  body: unknown,
): { accountId: string; chargeId: string; action: string } | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Request body must be a JSON object." };
  }

  const row = body as Record<string, unknown>;
  if (typeof row.accountId !== "string" || typeof row.chargeId !== "string") {
    return { error: "Account id, charge id, and action are required." };
  }
  if (typeof row.action !== "string") {
    return { error: "Account id, charge id, and action are required." };
  }

  const accountId = row.accountId.trim();
  const chargeId = row.chargeId.trim();
  const action = row.action.trim();
  if (
    !accountId ||
    !chargeId ||
    !action ||
    accountId.length > 80 ||
    chargeId.length > 80 ||
    action.length > 80
  ) {
    return { error: "Account id, charge id, and action are required." };
  }

  return { accountId, chargeId, action };
}

export function confirmHttpBody(result: ConfirmRefundResult): Record<string, unknown> {
  if (!result.ok) return { ok: false, error: result.error };
  if (!result.started) {
    return {
      started: false,
      status: "rejected",
      accountId: result.refund.accountId,
      chargeId: result.refund.chargeId,
      reason: result.refund.reason,
      message: REFUND_NOT_STARTED,
    };
  }
  return {
    started: true,
    status: "pending",
    accountId: result.refund.accountId,
    chargeId: result.refund.chargeId,
    reason: result.refund.reason,
    message: REFUND_QUEUED,
  };
}

export async function confirmRefund(
  input: ConfirmRefundInput,
  deps: { queueRefund?: QueueFn; used?: Set<string> } = {},
): Promise<ConfirmRefundResult> {
  if (!verifySession(input.sessionToken, input.now)) {
    return {
      ok: false,
      status: 401,
      error: "Sign in required.",
      clearProposal: false,
    };
  }

  const proposal = readProposal(input.proposalToken, input.now);
  if (!proposal || !input.proposalToken) {
    return {
      ok: false,
      status: 403,
      error: "No refund proposal to confirm. Nothing was queued.",
      clearProposal: Boolean(input.proposalToken),
    };
  }

  const used = deps.used ?? usedProposals;
  const key = proposalKey(input.proposalToken);
  if (used.has(key)) {
    return {
      ok: false,
      status: 403,
      error: "That proposal was already used. Nothing was queued.",
      clearProposal: true,
    };
  }

  if (
    input.accountId !== proposal.accountId ||
    input.chargeId !== proposal.chargeId ||
    input.action !== proposal.action
  ) {
    return {
      ok: false,
      status: 403,
      error: "That confirm does not match the stored proposal. Nothing was queued.",
      clearProposal: false,
    };
  }

  used.add(key);
  const queue = deps.queueRefund ?? queueRefundService;
  if (process.env.NODE_ENV === "development") {
    console.log("confirmRefund calling queueRefund:", {
      accountId: proposal.accountId,
      chargeId: proposal.chargeId,
      action: proposal.action,
    });
  }
  try {
    const refund = await queue({
      accountId: proposal.accountId,
      chargeId: proposal.chargeId,
    });
    if (process.env.NODE_ENV === "development") {
      console.log("confirmRefund queueRefund result:", {
        started: refund.started,
        status: refund.status,
        accountId: refund.accountId,
        chargeId: refund.chargeId,
      });
    }
    return {
      ok: true,
      status: 200,
      started: refund.started,
      refund,
      clearProposal: true,
    };
  } catch (error) {
    used.delete(key);
    throw error;
  }
}

function proposalKey(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
