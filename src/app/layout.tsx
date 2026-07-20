import type { Metadata, Viewport } from "next";
import { Heebo, Frank_Ruhl_Libre, Assistant } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { SwRegister } from "@/components/sw-register";
import "./globals.css";
// The "gold" skin — now the warm light shell, and the default for everyone.
// (The name is historical: it began as obsidian + antique gold. The attribute
// value stayed "gold" so stored preferences and ?skin= keep working.) ALL rules
// inside are scoped under html[data-skin="gold"], so the import is inert for
// the coral fallback. Imported AFTER globals.css on purpose: keeps skin rules
// later in source order so they win specificity ties against globals.css.
import "./skin-gold.css";
// The printable document sheet's own stylesheet. Imported LAST on purpose:
// its `.doc-*` rules must win ties against the gold skin's utility remaps so
// the paper renders identically on screen, in the editor preview and in the
// server-side PDF. See the header comment in document-paper.css.
import "./document-paper.css";

// SELF-HOSTED FONTS (was: two Google-Fonts <link> tags in <head>).
// The PDF route drives headless Chrome on a serverless box to /view and prints
// it — a third-party CDN fetch there is a real availability risk (a slow or
// blocked fonts.gstatic.com would silently print the document in a fallback
// face). next/font downloads the files at BUILD time and serves them from our
// own origin, so the PDF can't lose its typography. Exposed as CSS variables
// because globals.css / skin-gold.css / document-paper.css reference the
// families by name.
const heebo = Heebo({
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  subsets: ["hebrew", "latin"],
  variable: "--font-heebo",
  display: "swap",
});
const frankRuhl = Frank_Ruhl_Libre({
  weight: ["400", "500", "700", "900"],
  subsets: ["hebrew", "latin"],
  variable: "--font-frank",
  display: "swap",
});
const assistant = Assistant({
  weight: ["300", "400", "600", "700", "800"],
  subsets: ["hebrew", "latin"],
  variable: "--font-assistant",
  display: "swap",
});

// Inline pre-hydration script — applies the skin to <html> BEFORE first paint,
// avoiding any flash of the coral look. Mirrors applyDom() in src/lib/skin.ts,
// which it cannot import (this runs before any module loads); keep the two in
// step. The gold skin is the DEFAULT: with no override, data-skin="gold" is set.
// A one-time migration clears any beta-era stored skin preference so every
// user lands on gold. Internal escape hatch: ?skin=coral forces (and persists)
// the classic coral look; ?skin=gold flips back. The string is hardcoded (no
// user input flows into it), so it's safe.
// NOTE (2026-07-20): the coral-era `invoice-app:theme=dark` opt-in is gone.
// Its UI toggle was removed long ago, and the html.dark palette-inversion
// block it drove has since been deleted from globals.css (git history is the
// reference). The `classList.remove("dark")` below is the belt-and-braces
// cleanup for a class left on the element by anything else — nothing in the
// app adds it.
const themeInitScript = `(function(){try{var d=document.documentElement;var p=new URLSearchParams(location.search);var qs=p.get("skin");if(!localStorage.getItem("invoice-app:skin-default-gold")){localStorage.removeItem("invoice-app:skin");localStorage.setItem("invoice-app:skin-default-gold","1");}if(qs==="gold"||qs==="coral"){localStorage.setItem("invoice-app:skin",qs);}var s=localStorage.getItem("invoice-app:skin");if(s==="coral"){d.removeAttribute("data-skin");}else{d.setAttribute("data-skin","gold");}d.classList.remove("dark");}catch(e){}})();`;

const SITE_URL = "https://mysuperfriendlyinvoiceapp.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "MySuperFriendlyInvoiceApp - חשבוניות וקבלות בלי כאב ראש",
    template: "%s | MySuperFriendlyInvoiceApp",
  },
  description:
    "אפליקציית חשבוניות לעצמאיים. הפק קבלות, חשבונות עסקה וחשבוניות מס במהירות. שליחה במייל, ניהול לקוחות, דשבורד עם גרפים.",
  keywords: [
    "חשבוניות",
    "קבלות",
    "עוסק פטור",
    "עוסק מורשה",
    "חשבונית מס",
    "חשבון עסקה",
    "חשבוניות אונליין",
    "ניהול עסק",
  ],
  manifest: "/manifest.json",
  icons: {
    icon: "/logo.svg",
    apple: "/logo.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "MyInvoice",
  },
  openGraph: {
    type: "website",
    locale: "he_IL",
    url: SITE_URL,
    siteName: "MySuperFriendlyInvoiceApp",
    title: "MySuperFriendlyInvoiceApp - חשבוניות וקבלות בלי כאב ראש",
    description:
      "אפליקציית חשבוניות לעצמאיים. ניהול לקוחות, שליחה במייל, דשבורד עם גרפים.",
    // images intentionally omitted — Next picks up src/app/opengraph-image.tsx
    // automatically and generates a 1200x630 card.
  },
  twitter: {
    card: "summary_large_image",
    title: "MySuperFriendlyInvoiceApp - חשבוניות וקבלות בלי כאב ראש",
    description: "אפליקציית חשבוניות לעצמאיים",
    // images: same — file-based generation handles it.
  },
};

export const viewport: Viewport = {
  // Warm sand — matches the light app shell's page background.
  themeColor: "#f7f4ed",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`h-full antialiased ${heebo.variable} ${frankRuhl.variable} ${assistant.variable}`}
    >
      <head>
        {/* Raw SYNCHRONOUS inline script — must run before the body paints so
            there's zero flash of the old coral look before the gold default is
            applied. next/script's beforeInteractive is NOT synchronous in the
            App Router (it defers execution to the async runtime bootstrap, i.e.
            after first paint), so we inline it directly in <head> instead. */}
        <script
          id="theme-init"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body className="min-h-full flex flex-col font-sans text-stone-800">
        {children}
        <SwRegister />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
