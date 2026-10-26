/**
 * Workspace route at /workspace. Operators need a valid demo session cookie;
 * otherwise the server sends them to /login. It renders the workspace. Account
 * facts and the pending queue are loaded in the browser from routes that call
 * lib/. This page does not queue a refund, search policy, or call a model.
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
