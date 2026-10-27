/**
 * POST /api/chat. With a valid demo session cookie, asks OpenAI for one chat
 * completion and returns the model's text. Without that cookie it returns 401
 * and no reply. The API key stays in OPENAI_API_KEY on the server. This route
 * does not register tools, look up an account, decide a refund, or write a
 * pending row.
 */

import { cookies } from "next/headers";
import { completeChatTurn } from "../../../lib/chat";
import { SESSION_COOKIE_NAME, verifySession } from "../../../lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

const MAX_MESSAGE_LENGTH = 2000;

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value)) {
    return Response.json({ ok: false }, { status: 401, headers: NO_STORE });
  }

  const parsed = await readMessage(request);
  if ("error" in parsed) {
    return Response.json(
      { error: parsed.error },
      { status: 400, headers: NO_STORE },
    );
  }

  if (process.env.NODE_ENV === "development") {
    console.log("POST /api/chat received:", {
      body: { message: parsed.message },
    });
  }

  const result = await completeChatTurn(parsed.message);

  if (result.ok && result.usage) {
    console.log("POST /api/chat usage:", {
      prompt_tokens: result.usage.promptTokens,
      completion_tokens: result.usage.completionTokens,
      total_tokens: result.usage.totalTokens,
    });
  }

  if (process.env.NODE_ENV === "development") {
    console.log(
      "POST /api/chat response:",
      result.ok
        ? { reply: result.reply }
        : { status: result.status, error: result.error, reason: result.reason },
    );
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

  return Response.json({ reply: result.reply }, { status: 200, headers: NO_STORE });
}

async function readMessage(
  request: Request,
): Promise<{ message: string } | { error: string }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: "Request body must be JSON." };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Request body must be a JSON object." };
  }

  const row = body as Record<string, unknown>;
  if (typeof row.message !== "string") {
    return { error: "A message is required." };
  }

  const message = row.message.trim();
  if (!message) {
    return { error: "A message is required." };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { error: "That message is too long." };
  }

  return { message };
}
