/**
 * Plain home page for the local app shell. It confirms the Next.js server is
 * running and sends operators to demo login, or to the workspace once the
 * server sees a valid session cookie. It does not look up accounts, list
 * charges, queue refunds, or call a model.
 */

import { cookies } from "next/headers";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySession } from "../lib/session";
import styles from "./page.module.css";

export default async function HomePage() {
  const cookieStore = await cookies();
  const signedIn = verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  return (
    <main className={styles.main}>
      <h1>Northline Copilot</h1>
      <p>The app shell is running.</p>
      <p>
        {signedIn ? (
          <Link className={styles.link} href="/workspace">
            Open the workspace
          </Link>
        ) : (
          <Link className={styles.link} href="/login">
            Sign in to open the workspace
          </Link>
        )}
      </p>
    </main>
  );
}
