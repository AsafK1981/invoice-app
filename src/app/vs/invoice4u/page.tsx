import type { Metadata } from "next";
import { ComparisonView } from "@/components/comparison-view";
import { COMPETITORS } from "@/lib/comparison-data";

const competitor = COMPETITORS.invoice4u;

export const metadata: Metadata = {
  title: "MySuperFriendlyInvoiceApp vs Invoice4U — השוואת מחירים ופיצ'רים (2026)",
  description:
    "השוואה הוגנת בין MySuperFriendlyInvoiceApp ל-Invoice4U — מחירים, פיצ'רים, ייתרונות וחסרונות של כל אחד. ₪29 לחודש לללא הגבלה מול ₪82 ב-Invoice4U.",
  keywords: [
    "Invoice4U השוואה",
    "חלופה ל-Invoice4U",
    "Invoice4U alternative",
    "תוכנת חשבוניות השוואה",
    "חשבוניות אונליין",
    "עוסק פטור",
  ],
  alternates: { canonical: "/vs/invoice4u" },
  openGraph: {
    title: "MySuperFriendlyInvoiceApp vs Invoice4U",
    description: "השוואה הוגנת — מי באמת זול ועשיר יותר בפיצ'רים?",
    url: "/vs/invoice4u",
    type: "article",
  },
};

export default function VsInvoice4U() {
  return <ComparisonView competitor={competitor} />;
}
