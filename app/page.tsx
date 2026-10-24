/**
 * Plain home page for the local app shell. It confirms the Next.js server is
 * running and links to the empty workspace. It does not look up accounts, list
 * charges, queue refunds, or call a model.
 */

import Link from "next/link";
import styles from "./page.module.css";

export default function HomePage() {
  return (
    <main className={styles.main}>
      <h1>Northline Copilot</h1>
      <p>The app shell is running.</p>
      <p>
        <Link className={styles.link} href="/workspace">
          Open the workspace
        </Link>
      </p>
    </main>
  );
}
