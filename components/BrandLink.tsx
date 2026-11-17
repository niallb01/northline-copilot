/**
 * Logo mark and wordmark link. Used in marketing and workspace headers.
 */

import Link from "next/link";
import styles from "./BrandLink.module.css";
import { Logo } from "./Logo";

export function BrandLink({
  href = "/",
  theme = "light",
}: {
  href?: string;
  theme?: "light" | "dark";
}) {
  const themeClass = theme === "dark" ? styles.dark : styles.light;

  return (
    <Link className={`${styles.brand} ${themeClass}`} href={href}>
      <Logo className={styles.mark} />
      <span className={styles.wordmark}>
        Northline <span className={styles.wordmarkMuted}>Copilot</span>
      </span>
    </Link>
  );
}