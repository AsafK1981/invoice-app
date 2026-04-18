import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "מערכת חשבוניות",
  description: "ניהול חשבוניות וקבלות לעסק",
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
