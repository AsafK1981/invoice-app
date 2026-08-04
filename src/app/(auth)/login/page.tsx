import type { Metadata } from "next";
import LoginClient from "./login-client";

export const metadata: Metadata = {
  title: "התחברות",
  description:
    "התחבר או הירשם לחשבונית ידידותית - אפליקציית החשבוניות והקבלות לעצמאים בישראל.",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: true },
};

/**
 * /login, server wrapper that owns the page metadata (title/description/
 * canonical/robots). The actual form (email/password, signup, forgot
 * password, ?mode=signup deep link) is a client component (LoginClient),
 * since a "use client" module cannot itself export `metadata`. Follows the
 * same split as /status + StatusV2Client.
 */
export default function LoginPage() {
  return <LoginClient />;
}
