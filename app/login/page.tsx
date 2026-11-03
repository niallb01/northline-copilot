/**
 * Demo login route. It shows the password form or a signed-in state, then links
 * to the workspace. It does not read the session from browser JavaScript.
 */

import { cookies } from "next/headers";
import Link from "next/link";
import { LoginForm } from "../../components/LoginForm";
import { MarketingCard, MarketingShell } from "../../components/MarketingShell";
import { SESSION_COOKIE_NAME, verifySession } from "../../lib/session";
import shell from "../../components/MarketingShell.module.css";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const signedIn = verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  return (
    <MarketingShell>
      <MarketingCard
        title={signedIn ? "You are signed in" : "Sign in to the demo"}
        subtitle={
          signedIn
            ? "Your session cookie is HttpOnly. Page scripts cannot read it."
            : "One shared password for this portfolio demo. It is checked on the server only."
        }
      >
        {signedIn ? (
          <div className={shell.actions}>
            <Link className={shell.primaryButton} href="/workspace">
              Open workspace
            </Link>
          </div>
        ) : (
          <>
            <div className={shell.callout}>
              <span className={shell.calloutLabel}>Demo password</span>
              Use <code className={shell.code}>northline-demo</code> to continue.
            </div>
            <LoginForm />
          </>
        )}
        <div className={shell.footerLinks}>
          <Link className={shell.textLink} href="/">
            Home
          </Link>
        </div>
      </MarketingCard>
    </MarketingShell>
  );
}
