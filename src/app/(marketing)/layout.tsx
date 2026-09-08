import type { Metadata } from "next";
import "./v2.css";
// After v2.css on purpose: keeps the internal-linking rules later in source
// order so they win specificity ties, same convention as app-skin.css.
import "./internal-links.css";

// Heebo and Assistant inherit the root layout's self-hosted font variables.
// Redeclaring them here generated duplicate faces and preload instructions.

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
    <div className="v2-theme">
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
