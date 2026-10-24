/**
 * Placeholder for a route that requires the demo session. It returns 200 when
 * the signed cookie is valid and 401 when the cookie is missing or bad. It
 * does not load an account, list charges, or queue a refund.
 */

import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySession } from "../../../lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!verifySession(token)) {
    return Response.json({ ok: false }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  return Response.json({ ok: true }, { status: 200, headers: { "cache-control": "no-store" } });
}
