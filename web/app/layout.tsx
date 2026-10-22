import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "OnHolidai",
  description:
    "Plan a private multi-destination holiday with AI. Start without an account, review estimated proposals, and approve every change.",
  icons: {
    icon: [
      { url: "/logo/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/logo/main_icon.svg", type: "image/svg+xml", sizes: "any" },
    ],
    apple: [{ url: "/logo/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
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
