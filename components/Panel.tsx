/**
 * A labeled region on the workspace. It shows a heading and whatever body it
 * is given. It does not load accounts, charges, policy text, or the pending
 * queue, and it does not offer an action that queues a refund.
 */

import type { ReactNode } from "react";
import styles from "./Panel.module.css";

export function Panel({
  title,
  fill = false,
  scrollBody = false,
  children,
}: {
  title: string;
  fill?: boolean;
  /** When true, the body scrolls inside the panel instead of growing the page. */
  scrollBody?: boolean;
  children?: ReactNode;
}) {
  const className = fill ? `${styles.panel} ${styles.fill}` : styles.panel;
  const bodyClass = scrollBody ? `${styles.body} ${styles.scrollBody}` : styles.body;

  return (
    <section className={className}>
      <h2 className={styles.title}>{title}</h2>
      <div className={bodyClass}>{children}</div>
    </section>
  );
}
