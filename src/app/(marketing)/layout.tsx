import type { Metadata } from "next";
import { Heebo, Assistant } from "next/font/google";
import "./v2.css";
// After v2.css on purpose: keeps the internal-linking rules later in source
// order so they win specificity ties, same convention as app-skin.css.
import "./internal-links.css";

// Headline face. Was Frank_Ruhl_Libre until 2026-07-28; the serif read
// biblical rather than modern-premium, so the whole marketing site moved to
// Heebo (clean Hebrew sans, Roboto-derived). Body copy stays Assistant.
// Weights: 700/800/900 are what the display rules ask for; 400/500 cover the
// few rules that set the headline family and inherit a normal weight
// (`.v2-status-row .val`), which used to be faked by the browser from Frank's
// 500.
//
// The hero's mock invoice (`.v2-sh-name` / `.v2-sh-num` / `.v2-sh-grand`)
// used to stay serif on purpose, to depict the real printed document (still
// Frank Ruhl Libre). As of 2026-08-04 that exception is gone too - Asaf
// wanted the mock itself modernized - so those rules now read Heebo like
// everything else here. The real document is untouched.
const heebo = Heebo({
  weight: ["400", "500", "700", "800", "900"],
  subsets: ["hebrew", "latin"],
  variable: "--font-heebo",
  display: "swap",
});

const assistant = Assistant({
  weight: ["300", "400", "600", "700"],
  subsets: ["hebrew", "latin"],
  variable: "--font-assistant",
  display: "swap",
});

// This is now the REAL public marketing site (promoted from /v2). No noindex;
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
    <div className={`v2-theme ${heebo.variable} ${assistant.variable}`}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:right-4 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-xl focus:bg-white focus:text-stone-900 focus:shadow-lg focus:border"
      >
        דלג לתוכן
      </a>
      {children}
    </div>
  );
}
