/**
 * A labeled empty region on the workspace. It shows a heading and a blank body.
 * It does not load accounts, charges, policy text, or the pending queue, and it
 * does not offer an action that queues a refund.
 */

import styles from "./Panel.module.css";

export function Panel({ title, fill = false }: { title: string; fill?: boolean }) {
  const className = fill ? `${styles.panel} ${styles.fill}` : styles.panel;

  return (
    <section className={className}>
      <h2 className={styles.title}>{title}</h2>
      <div className={styles.body} />
    </section>
  );
}
