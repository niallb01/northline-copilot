/**
 * GET /api/accounts/[accountId]. With a valid demo session cookie, returns one
 * account and its charges by calling getAccount in lib/. Without that cookie
 * it returns 401 and no account JSON. It does not decide a refund, write a
 * pending row, or call a model.
 */

import { cookies } from "next/headers";
import { getAccount } from "../../../../lib/accounts";
import { SESSION_COOKIE_NAME, verifySession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(
  _request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const cookieStore = await cookies();
  if (!verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value)) {
    return Response.json({ ok: false }, { status: 401, headers: NO_STORE });
  }

  const { accountId } = await context.params;
  const query = decodeURIComponent(accountId).trim();
  if (!query || query.length > 80) {
    return Response.json({ error: "Search text is required." }, { status: 400, headers: NO_STORE });
  }

  try {
    const account = await getAccount(query);
    if (!account) {
      return Response.json(
        { error: "No account with that id." },
        { status: 404, headers: NO_STORE },
      );
    }
    return Response.json(account, { status: 200, headers: NO_STORE });
  } catch {
    return Response.json(
      { error: "Could not load that account." },
      { status: 500, headers: NO_STORE },
    );
  }
}
