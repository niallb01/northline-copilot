/**
 * Demo login page. It shows the password form, then says the operator is
 * signed in once the server can verify the session cookie. It does not read
 * the cookie from browser JavaScript, load an account, or queue a refund.
 */

import { cookies } from "next/headers";
import Link from "next/link";
import { LoginForm } from "../../components/LoginForm";
import { SESSION_COOKIE_NAME, verifySession } from "../../lib/session";
import styles from "./page.module.css";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const signedIn = verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  return (
    <main className={styles.main}>
      <h1>Demo login</h1>
      {signedIn ? (
        <>
          <p>Signed in. The server accepted the session cookie. Page scripts cannot read it.</p>
          <p>
            <Link className={styles.link} href="/workspace">
              Open the workspace
            </Link>
          </p>
        </>
      ) : (
        <>
          <p>One shared demo password. It is checked on the server and is not kept as a token in the browser.</p>
          <LoginForm />
        </>
      )}
      <p>
        <a className={styles.link} href="/api/protected">
          Open the protected route
        </a>
      </p>
      <p>
        <Link className={styles.link} href="/">
          Back home
        </Link>
      </p>
    </main>
  );
}
