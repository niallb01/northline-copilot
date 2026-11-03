/**
 * Shared layout for the home and login routes. It reuses the workspace header
 * colours and a centred card on a grey page background. It does not check
 * sessions, render chat, or queue refunds.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./MarketingShell.module.css";

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          Northline Copilot
        </Link>
      </header>
      <div className={styles.main}>{children}</div>
    </div>
  );
}

export function MarketingCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.card}>
      <h1 className={styles.title}>{title}</h1>
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      {children}
    </section>
  );
}
