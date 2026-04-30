import type { Metadata, Viewport } from "next";
import "./globals.css";

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
    images: [
      {
        url: "/logo.svg",
        width: 512,
        height: 512,
        alt: "MySuperFriendlyInvoiceApp",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "MySuperFriendlyInvoiceApp - חשבוניות וקבלות בלי כאב ראש",
    description: "אפליקציית חשבוניות חינמית לעצמאיים בישראל",
    images: ["/logo.svg"],
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
      </head>
      <body className="min-h-full flex flex-col font-sans text-stone-800">
        {children}
      </body>
    </html>
  );
}
