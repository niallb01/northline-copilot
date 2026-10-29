/**
 * POST /api/refunds/confirm. A human control posts here. This is not a model
 * tool. With a valid demo session, an unexpired unused proposal cookie, and a
 * body whose account id, charge id, and action match that proposal, it calls
 * queueRefund. A confirmed flag in the body is ignored. A rejected service
 * result inserts nothing. Without a match it does not call the service. This
 * route does not pay anyone.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { confirmHttpBody, confirmRefund, readConfirmRequest } from "../../../../lib/confirmRefund";
import { PROPOSAL_COOKIE_NAME, proposalCookieOptions } from "../../../../lib/proposal";
import { SESSION_COOKIE_NAME, verifySession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const CONFIRM_PATH = "/api/refunds/confirm";

export async function POST(request: Request) {
  const body = await readJson(request);
  if (process.env.NODE_ENV === "development") {
    console.log("POST /api/refunds/confirm received:", {
      method: "POST",
      url: request.url,
      path: CONFIRM_PATH,
      body,
    });
  }

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySession(sessionToken)) {
    return jsonReply({ ok: false, error: "Sign in required." }, 401, false);
  }

  if (body === undefined) {
    return jsonReply({ ok: false, error: "Request body must be JSON." }, 400, false);
  }

  const parsed = readConfirmRequest(body);
  if ("error" in parsed) {
    return jsonReply({ ok: false, error: parsed.error }, 400, false);
  }

  try {
    const result = await confirmRefund({
      sessionToken,
      proposalToken: cookieStore.get(PROPOSAL_COOKIE_NAME)?.value,
      accountId: parsed.accountId,
      chargeId: parsed.chargeId,
      action: parsed.action,
    });
    if (process.env.NODE_ENV === "development") {
      if (result.ok && result.started) {
        console.log("POST /api/refunds/confirm queued pending row:", {
          accountId: result.refund.accountId,
          chargeId: result.refund.chargeId,
        });
      } else if (result.ok && !result.started) {
        console.log("POST /api/refunds/confirm did not queue (service rejected):", {
          accountId: result.refund.accountId,
          chargeId: result.refund.chargeId,
          reason: result.refund.reason,
        });
      }
    }
    return jsonReply(confirmHttpBody(result), result.status, result.clearProposal);
  } catch {
    return jsonReply({ ok: false, error: "Could not confirm that refund." }, 500, false);
  }
}

function jsonReply(body: Record<string, unknown>, status: number, clearProposal: boolean) {
  if (process.env.NODE_ENV === "development") {
    console.log("POST /api/refunds/confirm response:", {
      method: "POST",
      path: CONFIRM_PATH,
      status,
      body,
      clearProposal,
    });
  }

  const response = NextResponse.json(body, { status, headers: NO_STORE });
  if (clearProposal) {
    response.cookies.set(PROPOSAL_COOKIE_NAME, "", {
      ...proposalCookieOptions(),
      maxAge: 0,
    });
  }
  return response;
}

async function readJson(request: Request): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
