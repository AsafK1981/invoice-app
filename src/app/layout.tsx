import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

// Inline pre-hydration theme script — applies the user's persisted theme
// choice to <html class="dark"> BEFORE first paint, avoiding a flash of
// light when the user has chosen dark. The string is hardcoded (no user
// input flows into it), so it's safe.
const themeInitScript = `(function(){try{var t=localStorage.getItem("invoice-app:theme");if(t==="dark"){document.documentElement.classList.add("dark");}}catch(e){}})();`;

const SITE_URL = "https://mysuperfriendlyinvoiceapp.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "MySuperFriendlyInvoiceApp - חשבוניות וקבלות בלי כאב ראש",
    template: "%s | MySuperFriendlyInvoiceApp",
  },
  description:
    "אפליקציית חשבוניות חינמית לעצמאיים בישראל. הפק קבלות, חשבונות עסקה וחשבוניות מס במהירות. שליחה במייל, ניהול לקוחות, דשבורד עם גרפים. עברית מלאה.",
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
      "אפליקציית חשבוניות חינמית לעצמאיים בישראל. עברית מלאה, ניהול לקוחות, שליחה במייל, דשבורד עם גרפים.",
    // images intentionally omitted — Next picks up src/app/opengraph-image.tsx
    // automatically and generates a 1200x630 card.
  },
  twitter: {
    card: "summary_large_image",
    title: "MySuperFriendlyInvoiceApp - חשבוניות וקבלות בלי כאב ראש",
    description: "אפליקציית חשבוניות חינמית לעצמאיים בישראל",
    // images: same — file-based generation handles it.
  },
};

export const viewport: Viewport = {
  themeColor: "#f97316",
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
        <Script
          id="theme-init"
          strategy="beforeInteractive"
        >
          {themeInitScript}
        </Script>
      </head>
      <body className="min-h-full flex flex-col font-sans text-stone-800">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
