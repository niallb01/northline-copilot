/**
 * POST /api/pending-refunds/review. With a valid demo session cookie, sets one
 * pending refund to reviewed by calling markRefundReviewed in lib/. The body
 * is the account id and charge id. Without that cookie it returns 401 and
 * changes nothing. It does not send money, write a payment, or call a model.
 */

import { cookies } from "next/headers";
import { markRefundReviewed } from "../../../../lib/refunds";
import { SESSION_COOKIE_NAME, verifySession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value)) {
    return Response.json({ ok: false }, { status: 401, headers: NO_STORE });
  }

  const ids = await readIds(request);
  if (!ids) {
    return Response.json(
      { error: "Account id and charge id are required." },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const refund = await markRefundReviewed(ids);
    if (!refund) {
      return Response.json(
        { error: "That refund is not waiting for review." },
        { status: 404, headers: NO_STORE },
      );
    }
    return Response.json(refund, { status: 200, headers: NO_STORE });
  } catch {
    return Response.json(
      { error: "Could not mark that refund reviewed." },
      { status: 500, headers: NO_STORE },
    );
  }
}

async function readIds(
  request: Request,
): Promise<{ accountId: string; chargeId: string } | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;

  const row = body as Record<string, unknown>;
  if (typeof row.accountId !== "string" || typeof row.chargeId !== "string") return null;

  const accountId = row.accountId.trim();
  const chargeId = row.chargeId.trim();
  if (!accountId || !chargeId || accountId.length > 80 || chargeId.length > 80) return null;

  return { accountId, chargeId };
}
