/**
 * POST /api/chat. With a valid demo session cookie, checks the new message and
 * prior user and assistant turns, caps that history, and asks OpenAI for a
 * completion. If the model requests get_account, the server runs that tool and
 * returns the model's final sentence plus the tool name and arguments. Without
 * the cookie it returns 401 and no reply. The API key and the system prompt stay
 * on the server. This route does not register list_charges, decide a refund,
 * store the thread, or write a pending row.
 */

import { cookies } from "next/headers";
import { completeChatTurn, readChatRequest } from "../../../lib/chat";
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
    console.log("POST /api/chat usage:", {
      prompt_tokens: result.usage.promptTokens,
      completion_tokens: result.usage.completionTokens,
      total_tokens: result.usage.totalTokens,
    });
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
      });
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

  return Response.json(
    { reply: result.reply, toolCalls: result.toolCalls },
    { status: 200, headers: NO_STORE },
  );
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
