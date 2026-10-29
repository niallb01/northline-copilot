/**
 * Signs a refund proposal the chat route can store on an HttpOnly cookie after
 * an eligible preview. The proposal names one account, one charge, the action
 * request_refund, and an expiry. This file does not set the cookie, run a
 * tool, insert a pending row, or mark a proposal used. Each signature includes
 * a random nonce so one cookie cannot stand in for another. The model never
 * receives the signed value.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const PROPOSAL_COOKIE_NAME = "northline_proposal";

/** How long a preview stays confirmable. Shorter than the demo login session. */
export const PROPOSAL_MAX_AGE_SECONDS = 15 * 60;

export type ProposalDraft = {
  accountId: string;
  chargeId: string;
  action: "request_refund";
};

export type RefundProposal = ProposalDraft & {
  /** Unix seconds when this proposal stops being valid. */
  exp: number;
};

export type ProposalCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

export type SignedProposal = {
  token: string;
  exp: number;
};

export function proposalCookieOptions(): ProposalCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PROPOSAL_MAX_AGE_SECONDS,
  };
}

export function signProposal(draft: ProposalDraft, now = Date.now()): SignedProposal | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  if (draft.action !== "request_refund") return null;

  const accountId = draft.accountId.trim();
  const chargeId = draft.chargeId.trim();
  if (!accountId || !chargeId || accountId.length > 80 || chargeId.length > 80) return null;

  const exp = Math.floor(now / 1000) + PROPOSAL_MAX_AGE_SECONDS;
  const payload = encodePayload({ accountId, chargeId, action: "request_refund", exp });
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return { token: `${payload}.${signature}`, exp };
}

export function readProposal(token: string | undefined, now = Date.now()): RefundProposal | null {
  if (!token) return null;

  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  const parsed = decodePayload(payload);
  if (!parsed) return null;

  const nowSeconds = Math.floor(now / 1000);
  if (parsed.exp <= nowSeconds) return null;
  if (parsed.exp > nowSeconds + PROPOSAL_MAX_AGE_SECONDS) return null;
  return parsed;
}

function encodePayload(proposal: RefundProposal): string {
  const stored = { ...proposal, nonce: randomBytes(16).toString("base64url") };
  return Buffer.from(JSON.stringify(stored), "utf8").toString("base64url");
}

function decodePayload(payload: string): RefundProposal | null {
  let text: string;
  try {
    text = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const row = value as Record<string, unknown>;
  if (row.action !== "request_refund") return null;
  if (typeof row.accountId !== "string" || typeof row.chargeId !== "string") return null;

  const accountId = row.accountId.trim();
  const chargeId = row.chargeId.trim();
  if (!accountId || !chargeId || accountId.length > 80 || chargeId.length > 80) return null;
  if (typeof row.exp !== "number" || !Number.isSafeInteger(row.exp)) return null;

  return { accountId, chargeId, action: "request_refund", exp: row.exp };
}
