import type { Metadata, Viewport } from "next";
import { Heebo, Frank_Ruhl_Libre, Assistant } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { SwRegister } from "@/components/sw-register";
import "./globals.css";
// THE app skin, the warm light shell every user sees. Unconditional since
// 2026-07-20 (it used to be gated behind html[data-skin="gold"], with a
// ?skin=coral fallback to the legacy design; that second, untested visual
// state is gone). Imported AFTER globals.css on purpose: keeps skin rules
// later in source order so they win specificity ties against globals.css.
import "./app-skin.css";
// The printable document sheet's own stylesheet. Imported LAST on purpose:
// its `.doc-*` rules must win ties against the app skin's utility remaps so
// the paper renders identically on screen, in the editor preview and in the
// server-side PDF. See the header comment in document-paper.css.
import "./document-paper.css";

// SELF-HOSTED FONTS (was: two Google-Fonts <link> tags in <head>).
// The PDF route drives headless Chrome on a serverless box to /view and prints
// it; a third-party CDN fetch there is a real availability risk (a slow or
// blocked fonts.gstatic.com would silently print the document in a fallback
// face). next/font downloads the files at BUILD time and serves them from our
// own origin, so the PDF can't lose its typography. Exposed as CSS variables
// because globals.css / app-skin.css / document-paper.css reference the
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

// NOTE (2026-07-20): there used to be a synchronous inline <head> script here
// that read localStorage and set html[data-skin] before first paint, so the
// gated skin applied without a flash of the legacy coral look. Both the gate
// and the coral fallback are gone (app-skin.css now applies unconditionally),
// so the script had no job left. Deleting it also removed a render-blocking
// localStorage read and the React hydration-attribute warning it caused. The
// `classList.remove("dark")` it also carried was belt-and-braces for a class
// nothing in the app ever adds, and which could not survive a page load anyway
// (the server renders <html>'s className).
// Orphan keys `invoice-app:skin` / `invoice-app:skin-default-gold` may linger
// in returning users' localStorage; nothing reads them. Not worth re-adding a
// blocking script to clear.

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
    // images intentionally omitted; Next picks up src/app/opengraph-image.tsx
    // automatically and generates a 1200x630 card.
  },
  twitter: {
    card: "summary_large_image",
    title: "MySuperFriendlyInvoiceApp - חשבוניות וקבלות בלי כאב ראש",
    description: "אפליקציית חשבוניות לעצמאיים",
    // images: same, file-based generation handles it.
  },
};

export const viewport: Viewport = {
  // Warm sand: matches the light app shell's page background.
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
      <body className="min-h-full flex flex-col font-sans text-stone-800">
        {children}
        <SwRegister />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
