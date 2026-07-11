import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { SwRegister } from "@/components/sw-register";
import "./globals.css";
// Opt-in "gold" skin (obsidian + antique gold, art-deco). ALL rules inside
// are scoped under html[data-skin="gold"], so importing it here is inert for
// the default coral app — it only takes effect once the skin flag is set.
// Imported AFTER globals.css on purpose: keeps gold rules later in source
// order so they win ties against the html.dark block.
import "./skin-gold.css";

// Inline pre-hydration script — applies the black-gold skin to <html> BEFORE
// first paint, avoiding any flash of the old coral look. The gold skin is now
// the DEFAULT for everyone: with no override, <html data-skin="gold"> is set.
// A one-time migration clears any beta-era stored skin preference so every
// user lands on gold. Internal escape hatch: ?skin=coral forces (and persists)
// the classic coral look; ?skin=gold flips back. The string is hardcoded (no
// user input flows into it), so it's safe.
const themeInitScript = `(function(){try{var d=document.documentElement;var p=new URLSearchParams(location.search);var qs=p.get("skin");if(!localStorage.getItem("invoice-app:skin-default-gold")){localStorage.removeItem("invoice-app:skin");localStorage.setItem("invoice-app:skin-default-gold","1");}if(qs==="gold"||qs==="coral"){localStorage.setItem("invoice-app:skin",qs);}var s=localStorage.getItem("invoice-app:skin");if(s==="coral"){d.removeAttribute("data-skin");}else{d.setAttribute("data-skin","gold");}var t=localStorage.getItem("invoice-app:theme");if(t==="dark"){d.classList.add("dark");}}catch(e){}})();`;

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
  // Obsidian to match the black-gold default skin (was coral #f97316).
  themeColor: "#0d0a07",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" className="h-full antialiased">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
        {/* Fonts for the opt-in gold skin: Frank Ruhl Libre (art-deco serif
            headings) + Assistant (body). Small extra download, only used when
            html[data-skin="gold"] is active; inert for the default app. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@500;700;900&family=Assistant:wght@300;400;600;700;800&display=swap"
          rel="stylesheet"
        />
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
