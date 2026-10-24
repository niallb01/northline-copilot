/**
 * Workspace route at /workspace. Operators need a valid demo session cookie;
 * otherwise the server sends them to /login. It renders the empty two-column
 * layout only. It does not read accounts, list charges, search policy, or
 * queue a refund.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Workspace } from "../../components/Workspace";
import { SESSION_COOKIE_NAME, verifySession } from "../../lib/session";

export default async function WorkspacePage() {
  const cookieStore = await cookies();
  if (!verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value)) {
    redirect("/login");
  }

  return <Workspace />;
}
