import type { Metadata } from "next";
import { ComparisonView } from "@/components/comparison-view";
import { COMPETITORS } from "@/lib/comparison-data";

const competitor = COMPETITORS.ifreelance;

export const metadata: Metadata = {
  title: "MySuperFriendlyInvoiceApp vs iFreelance — השוואת מחירים ופיצ'רים (2026)",
  description:
    "השוואה הוגנת בין MySuperFriendlyInvoiceApp ל-iFreelance — מחירים, פיצ'רים, יתרונות וחסרונות של כל אחד. ₪19-26 לחודש לעומת ₪19-29 שלנו, אבל עם UX מודרני יותר.",
  keywords: [
    "iFreelance השוואה",
    "חלופה ל-iFreelance",
    "iFreelance alternative",
    "תוכנת חשבוניות השוואה",
    "חשבוניות אונליין",
    "עוסק פטור",
    "פרילנסר חשבוניות",
  ],
  alternates: { canonical: "/vs/ifreelance" },
  openGraph: {
    title: "MySuperFriendlyInvoiceApp vs iFreelance",
    description: "השוואה הוגנת — מי באמת מתאים יותר לפרילנסר ישראלי?",
    url: "/vs/ifreelance",
    type: "article",
  },
};

export default function VsIFreelance() {
  return <ComparisonView competitor={competitor} />;
}
