/**
 * Shared layout for the home and login routes. It reuses the workspace header
 * colours and a centred card on a grey page background. It does not check
 * sessions, render chat, or queue refunds.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLink } from "./BrandLink";
import styles from "./MarketingShell.module.css";

export function MarketingShell({
  children,
  variant = "centered",
  headerAction,
}: {
  children: ReactNode;
  variant?: "centered" | "home";
  headerAction?: ReactNode;
}) {
  const pageClass = variant === "home" ? `${styles.page} ${styles.pageHome}` : styles.page;
  const mainClass = variant === "home" ? `${styles.main} ${styles.mainHome}` : styles.main;

  return (
    <div className={pageClass}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <BrandLink theme="light" />
          {headerAction ? <div className={styles.headerAction}>{headerAction}</div> : null}
        </div>
      </header>
      <div className={mainClass}>{children}</div>
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
