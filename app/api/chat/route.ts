/**
 * POST /api/chat. With a valid demo session cookie, returns one fixed stub
 * sentence and ignores the wording of the message. Without that cookie it
 * returns 401 and no reply. It does not call OpenAI, read an API key, run a
 * tool, decide a refund, or write a pending row.
 */

import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySession } from "../../../lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

const STUB_REPLY = "Stub reply: chat is connected. No model is answering yet.";

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
      reply: STUB_REPLY,
    });
  }

  return Response.json({ reply: STUB_REPLY }, { status: 200, headers: NO_STORE });
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
