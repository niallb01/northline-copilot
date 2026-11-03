/**
 * POST /api/chat. With a valid demo session cookie, checks the new message and
 * prior user and assistant turns, caps that history, and asks OpenAI for a
 * completion. If the model requests get_account, list_charges, search_policy, or
 * preview_refund, the server runs that tool and returns the model's final
 * sentence plus the tool name and arguments. search_policy passages are
 * returned for the citations panel. A quote is included only when its document
 * id and chunk id were in that turn's tool result and the quote is inside that
 * passage. When the preview would be pending, it stores that proposal on an
 * HttpOnly cookie and returns the account id, charge id, and action so the
 * operator can confirm. A successful turn with no eligible preview clears
 * that cookie, so an earlier customer cannot still be confirmed. The JSON
 * body has no confirmation token. Without the
 * session cookie it returns 401 and no reply. When the provider response includes
 * usage, it stores that turn's prompt, completion, and total tokens. The API key
 * and the system prompt stay on the server. This route does not store the
 * message text or write a pending row.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { completeChatTurn, readChatRequest } from "../../../lib/chat";
import { confirmOfferFromProposal } from "../../../lib/confirmOffer";
import { writeChatTokenUsage } from "../../../lib/tokenUsage";
import {
  PROPOSAL_COOKIE_NAME,
  proposalCookieOptions,
  signProposal,
} from "../../../lib/proposal";
import { SESSION_COOKIE_NAME, verifySession } from "../../../lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value)) {
    return Response.json({ ok: false }, { status: 401, headers: NO_STORE });
  }

  const parsed = await readMessage(request);
  if ("error" in parsed) {
    if (process.env.NODE_ENV === "development") {
      console.log("POST /api/chat rejected:", { error: parsed.error });
    }
    return Response.json(
      { error: parsed.error },
      { status: 400, headers: NO_STORE },
    );
  }

  if (process.env.NODE_ENV === "development") {
    console.log("POST /api/chat received:", {
      message: parsed.message,
      history: parsed.history.map((turn) => ({
        role: turn.role,
        content: turn.content,
      })),
    });
  }

  const result = await completeChatTurn(parsed.message, parsed.history);

  if (result.ok && result.usage) {
    if (process.env.NODE_ENV === "development") {
      console.log("POST /api/chat usage:", {
        prompt_tokens: result.usage.promptTokens,
        completion_tokens: result.usage.completionTokens,
        total_tokens: result.usage.totalTokens,
      });
    }
    try {
      await writeChatTokenUsage(result.usage);
    } catch {
      return Response.json(
        { error: "Could not record token usage." },
        { status: 500, headers: NO_STORE },
      );
    }
  }

  if (process.env.NODE_ENV === "development") {
    if (result.ok) {
      if (result.toolCalls.length > 0) {
        for (const call of result.toolCalls) {
          console.log(`POST /api/chat tool ran: ${call.name}`, call.arguments);
        }
      } else {
        console.log("POST /api/chat tool ran: (none this turn)");
      }
      console.log("POST /api/chat response:", {
        reply: result.reply,
        toolCalls: result.toolCalls.map((call) => ({
          name: call.name,
          arguments: call.arguments,
        })),
        policySources: result.policySources,
        policyPassages: result.policyPassages,
        citations: result.citations,
      });
      if (result.policyPassages.length > 0) {
        console.log(
          "POST /api/chat search_policy passages:",
          result.policyPassages.map((passage) => ({
            documentId: passage.documentId,
            chunkId: passage.chunkId,
            path: passage.path,
          })),
        );
      }
      console.log("POST /api/chat citations accepted:", result.citations);
    } else {
      console.log("POST /api/chat response:", {
        status: result.status,
        error: result.error,
        reason: result.reason,
      });
    }
  }

  if (!result.ok) {
    if (result.reason === "not_configured") {
      console.error("POST /api/chat: OPENAI_API_KEY is not set");
    }
    return Response.json(
      { error: result.error },
      { status: result.status, headers: NO_STORE },
    );
  }

  const offer = confirmOfferFromProposal(result.proposal);
  const signed = offer ? signProposal(offer) : null;
  const body = {
    reply: result.reply,
    toolCalls: result.toolCalls,
    policySources: result.policySources,
    policyPassages: result.policyPassages,
    citations: result.citations,
    ...(signed && offer ? { proposal: offer } : {}),
  };
  const response = NextResponse.json(body, { status: 200, headers: NO_STORE });
  if (signed && offer) {
    response.cookies.set(PROPOSAL_COOKIE_NAME, signed.token, proposalCookieOptions());
    if (process.env.NODE_ENV === "development") {
      console.log("POST /api/chat proposal stored:", {
        accountId: offer.accountId,
        chargeId: offer.chargeId,
        action: offer.action,
        expiresAt: new Date(signed.exp * 1000).toISOString(),
      });
      console.log("POST /api/chat confirm offer:", offer);
    }
  } else {
    response.cookies.set(PROPOSAL_COOKIE_NAME, "", {
      ...proposalCookieOptions(),
      maxAge: 0,
    });
    if (process.env.NODE_ENV === "development") {
      console.log("POST /api/chat proposal cleared");
      console.log("POST /api/chat confirm offer: none");
    }
  }
  return response;
}

async function readMessage(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: "Request body must be JSON." };
  }

  return readChatRequest(body);
}
