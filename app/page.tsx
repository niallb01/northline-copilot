/**
 * Marketing home for the demo app. It sends visitors to sign in or the
 * workspace when a session cookie is already valid. It does not load accounts
 * or call the model.
 */

import { cookies } from "next/headers";
import Link from "next/link";
import { MarketingCard, MarketingShell } from "../components/MarketingShell";
import { SESSION_COOKIE_NAME, verifySession } from "../lib/session";
import shell from "../components/MarketingShell.module.css";

export default async function HomePage() {
  const cookieStore = await cookies();
  const signedIn = verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  return (
    <MarketingShell>
      <MarketingCard
        title="Billing support workspace"
        subtitle="Investigate disputes, quote stored policy, and preview refunds. Eligibility is enforced in code; a person confirms before anything is queued."
      >
        <ul className={shell.featureList}>
          <li>Chat with tool-backed lookups and policy citations</li>
          <li>Refund previews that reject out-of-window charges with no write</li>
          <li>Same rules on the website and the local MCP server</li>
        </ul>
        <div className={shell.actions}>
          {signedIn ? (
            <Link className={shell.primaryButton} href="/workspace">
              Open workspace
            </Link>
          ) : (
            <>
              <Link className={shell.primaryButton} href="/login">
                Sign in to demo
              </Link>
              <p className={shell.muted}>
                Shared demo password: <code className={shell.code}>northline-demo</code>
              </p>
            </>
          )}
        </div>
      </MarketingCard>
    </MarketingShell>
  );
}
