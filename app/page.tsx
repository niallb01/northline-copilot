/**
 * Marketing home for the demo app. It sends visitors to sign in or the
 * workspace when a session cookie is already valid. It does not load accounts
 * or call the model.
 */

import { cookies } from "next/headers";
import Link from "next/link";
import home from "../components/HomePage.module.css";
import { MarketingShell } from "../components/MarketingShell";
import { SESSION_COOKIE_NAME, verifySession } from "../lib/session";
import shell from "../components/MarketingShell.module.css";

export default async function HomePage() {
  const cookieStore = await cookies();
  const signedIn = verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  return (
    <MarketingShell
      variant="home"
      headerAction={
        signedIn ? (
          <Link className={shell.headerLink} href="/workspace">
            Workspace
          </Link>
        ) : (
          <Link className={shell.headerLink} href="/login">
            Sign in
          </Link>
        )
      }
    >
      <section className={home.hero}>
        <div className={home.copy}>
          <p className={home.eyebrow}>Portfolio demo</p>
          <h1 className={home.title}>A billing desk that checks the rules before it answers.</h1>
          <p className={home.lead}>
            Ask about a customer in plain English. The model only chooses a lookup. Charges,
            policy, and refund decisions come from the server. A person confirms before anything
            is queued.
          </p>
          <div className={home.actions}>
            {signedIn ? (
              <Link className={shell.primaryButton} href="/workspace">
                Open workspace
              </Link>
            ) : (
              <Link className={shell.primaryButton} href="/login">
                Sign in to the demo
              </Link>
            )}
            {!signedIn ? (
              <p className={home.password}>
                Password <code className={home.code}>northline-demo</code>
              </p>
            ) : null}
          </div>
        </div>
        <aside className={home.preview} aria-label="Example workspace conversation">
          <div className={home.previewBar}>
            <span className={home.previewDot} aria-hidden="true" />
            Workspace
          </div>
          <div className={home.previewBody}>
            <p className={home.bubbleLabel}>You</p>
            <div className={home.bubbleUser}>
              Tom Ellis wants a refund on his September charge — are we allowed?
            </div>
            <p className={home.bubbleLabel}>Copilot</p>
            <div className={home.bubbleCopilot}>
              Tom Ellis on NL-1048292, £49.00 on 11 Sept 2026. Monthly charge is past the 14-day
              window. Refund not started. Nothing was saved.
            </div>
            <div className={home.previewPanels}>
              <div className={home.miniPanel}>
                <p className={home.miniLabel}>Confirm</p>
                <p className={home.miniTextMuted}>Nothing waiting to confirm.</p>
              </div>
              <div className={home.miniPanel}>
                <p className={home.miniLabel}>Policy</p>
                <p className={home.miniText}>Monthly refunds: within 14 days.</p>
              </div>
            </div>
          </div>
        </aside>
      </section>
      <ul className={home.features}>
        <li className={home.feature}>
          <p className={home.featureTitle}>Tool-backed chat</p>
          <p className={home.featureText}>
            Customer, charges, the pending queue, and stored policy. Off-topic questions are refused.
          </p>
        </li>
        <li className={home.feature}>
          <p className={home.featureTitle}>Rules in code</p>
          <p className={home.featureText}>
            Monthly charges have 14 days. Annual charges have 30. A duplicate charge can still qualify.
          </p>
        </li>
        <li className={home.feature}>
          <p className={home.featureTitle}>Human confirm</p>
          <p className={home.featureText}>
            An eligible preview unlocks Confirm. Only then does a pending row appear. Nothing is paid.
          </p>
        </li>
      </ul>
      <p className={home.footnote}>
        Synthetic customers only. Everyone who signs in with the demo password sees the same queue.
      </p>
    </MarketingShell>
  );
}
