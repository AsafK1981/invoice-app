import type { Metadata } from "next";
import { ComparisonViewV2 } from "../../components/ComparisonViewV2";
import { COMPETITORS } from "@/lib/comparison-data";

const competitor = COMPETITORS.greeninvoice;

export const metadata: Metadata = {
  title: "חשבונית סופר ידידותית vs חשבונית ירוקה — השוואת מחירים ופיצ'רים (2026)",
  description:
    "השוואה הוגנת בין חשבונית סופר ידידותית לחשבונית ירוקה (Greeninvoice). Pro ₪25 לחודש vs Extra ₪89 — אותם פיצ'רים, פי 3.5 זול.",
  keywords: [
    "חשבונית ירוקה השוואה",
    "חלופה לחשבונית ירוקה",
    "Greeninvoice alternative",
    "תוכנת חשבוניות השוואה",
    "חשבוניות אונליין",
    "עוסק פטור",
  ],
  alternates: { canonical: "/vs/greeninvoice" },
};

export default function V2VsGreenInvoice() {
  return <ComparisonViewV2 competitor={competitor} />;
}
