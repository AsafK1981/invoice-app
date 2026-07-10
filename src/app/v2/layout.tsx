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

export const metadata: Metadata = {
  title: "חשבונית — סופר ידידותית",
  description:
    "המערכת הכי ידידותית לעוסקים פטורים בישראל — עברית מלאה, עומדת בדרישות רשות המסים, במחיר הוגן.",
  robots: { index: false, follow: false },
  icons: { icon: "/logo-v2.svg" },
};

export default function V2Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`v2-theme ${frankRuhl.variable} ${assistant.variable}`}>
      {children}
    </div>
  );
}
