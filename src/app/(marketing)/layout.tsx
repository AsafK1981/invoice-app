import type { Metadata } from "next";
import { Frank_Ruhl_Libre, Assistant } from "next/font/google";
import "./v2.css";

const frankRuhl = Frank_Ruhl_Libre({
  weight: ["500", "700", "900"],
  subsets: ["hebrew", "latin"],
  variable: "--font-frank",
  display: "swap",
});

const assistant = Assistant({
  weight: ["300", "400", "600", "700"],
  subsets: ["hebrew", "latin"],
  variable: "--font-assistant",
  display: "swap",
});

// This is now the REAL public marketing site (promoted from /v2). No noindex —
// it should be indexed. Titles/description are inherited from the root layout
// (its title template + OG), except where a child page sets its own; that keeps
// the root domain's existing metadata intact.
export const metadata: Metadata = {
  icons: { icon: "/logo-v2.svg" },
};

export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`v2-theme ${frankRuhl.variable} ${assistant.variable}`}>
      {children}
    </div>
  );
}
