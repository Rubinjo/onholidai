import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Onholidai",
  description: "Plan a private multi-destination holiday with AI. Start without an account, review estimated proposals, and approve every change.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <div className="app-root" id="main-content" tabIndex={-1}>
          {children}
        </div>
      </body>
    </html>
  );
}
