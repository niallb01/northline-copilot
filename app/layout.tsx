/**
 * Root layout for the Northline Copilot web app. It supplies the HTML shell,
 * shared page styles, and the document title for every route. It does not load
 * accounts, render chat, or call the refund queue.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Northline Copilot",
  description: "Billing support workspace. Refunds are queued for human review.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
