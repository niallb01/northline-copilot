/**
 * POST /api/tools. With a valid demo session cookie, runs one tool through
 * dispatchTool in lib/ and returns that JSON result. Without the cookie it
 * returns 401 and does not run a tool. It does not call OpenAI, stream a
 * reply, decide a refund, or write a pending row.
 */

import { cookies } from "next/headers";
import { ACCOUNT_NOT_FOUND, dispatchTool, type ToolResult } from "../../../lib/tools";
import { SESSION_COOKIE_NAME, verifySession } from "../../../lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value)) {
    return Response.json({ ok: false }, { status: 401, headers: NO_STORE });
  }

  const call = await readToolCall(request);
  if ("error" in call) {
    return Response.json(
      { ok: false, tool: "", error: call.error },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const result = await dispatchTool(call.name, call.arguments);
    return Response.json(result, { status: statusFor(result), headers: NO_STORE });
  } catch {
    return Response.json(
      { ok: false, tool: "", error: "Could not run that tool." },
      { status: 500, headers: NO_STORE },
    );
  }
}

function statusFor(result: ToolResult): number {
  if (result.ok) return 200;
  if (result.error === ACCOUNT_NOT_FOUND) return 404;
  return 400;
}

async function readToolCall(
  request: Request,
): Promise<{ name: string; arguments: unknown } | { error: string }> {
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
  if (typeof row.name !== "string" || !row.name.trim()) {
    return { error: "Tool name is required." };
  }

  return { name: row.name, arguments: row.arguments ?? {} };
}
