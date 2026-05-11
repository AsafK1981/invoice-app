import type { Metadata } from "next";
import { ComparisonView } from "@/components/comparison-view";
import { COMPETITORS } from "@/lib/comparison-data";

const competitor = COMPETITORS.greeninvoice;

export const metadata: Metadata = {
  title: "MySuperFriendlyInvoiceApp vs חשבונית ירוקה — השוואת מחירים ופיצ'רים (2026)",
  description:
    "השוואה הוגנת בין MySuperFriendlyInvoiceApp לחשבונית ירוקה (Greeninvoice). Pro ₪29 לחודש vs Extra ₪89 — אותם פיצ'רים, פי 3 זול.",
  keywords: [
    "חשבונית ירוקה השוואה",
    "חלופה לחשבונית ירוקה",
    "Greeninvoice alternative",
    "תוכנת חשבוניות השוואה",
    "חשבוניות אונליין",
    "עוסק פטור",
  ],
  alternates: { canonical: "/vs/greeninvoice" },
  openGraph: {
    title: "MySuperFriendlyInvoiceApp vs חשבונית ירוקה",
    description: "השוואה הוגנת — מי באמת זול ועשיר יותר בפיצ'רים?",
    url: "/vs/greeninvoice",
    type: "article",
  },
};

export default function VsGreenInvoice() {
  return <ComparisonView competitor={competitor} />;
}
