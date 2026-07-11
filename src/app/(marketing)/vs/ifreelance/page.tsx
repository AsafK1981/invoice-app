import type { Metadata } from "next";
import { ComparisonViewV2 } from "../../components/ComparisonViewV2";
import { COMPETITORS } from "@/lib/comparison-data";

const competitor = COMPETITORS.ifreelance;

export const metadata: Metadata = {
  title: "חשבונית סופר ידידותית vs iFreelance — השוואת מחירים ופיצ'רים (2026)",
  description:
    "השוואה הוגנת בין חשבונית סופר ידידותית ל-iFreelance — מחירים, פיצ'רים, יתרונות וחסרונות של כל אחד. ₪19-26 לחודש לעומת ₪19-29 שלנו, אבל עם UX מודרני יותר.",
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
};

export default function V2VsIFreelance() {
  return <ComparisonViewV2 competitor={competitor} />;
}
