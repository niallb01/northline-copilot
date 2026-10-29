/**
 * GET /api/pending-refunds. With a valid demo session cookie, returns pending
 * refund rows by calling listPendingRefunds in lib/. Without that cookie it
 * returns 401 and no queue JSON. It does not mark a row reviewed, send money,
 * or call a model.
 */

import { cookies } from "next/headers";
import { listPendingRefunds } from "../../../lib/refunds";
import { SESSION_COOKIE_NAME, verifySession } from "../../../lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET() {
  const cookieStore = await cookies();
  if (!verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value)) {
    return Response.json({ ok: false }, { status: 401, headers: NO_STORE });
  }

  try {
    const pending = await listPendingRefunds();
    if (process.env.NODE_ENV === "development") {
      console.log("GET /api/pending-refunds response:", {
        pendingCount: pending.filter((row) => row.status === "pending").length,
        rows: pending.map((row) => ({
          accountId: row.accountId,
          chargeId: row.chargeId,
          status: row.status,
        })),
      });
    }
    return Response.json(pending, { status: 200, headers: NO_STORE });
  } catch {
    return Response.json(
      { error: "Could not load the pending queue." },
      { status: 500, headers: NO_STORE },
    );
  }
}
