import type { Metadata } from "next";
import { ComparisonViewV2 } from "../../components/ComparisonViewV2";
import { COMPETITORS } from "@/lib/comparison-data";

const competitor = COMPETITORS.ezcount;

export const metadata: Metadata = {
  title: "חשבונית סופר ידידותית vs EZcount — השוואת מחירים ופיצ'רים (2026)",
  description:
    "השוואה הוגנת בין חשבונית סופר ידידותית ל-EZcount (מבית Hyp) — מחירים, פיצ'רים ויתרונות של כל צד. אצלנו חינם עכשיו בהשקה, ואח\"כ מחיר כניסה תחרותי.",
  keywords: [
    "EZcount השוואה",
    "חלופה ל-EZcount",
    "EZcount alternative",
    "Hyp חשבוניות",
    "תוכנת חשבוניות השוואה",
    "עוסק פטור",
  ],
  alternates: { canonical: "/vs/ezcount" },
};

export default function V2VsEZcount() {
  return <ComparisonViewV2 competitor={competitor} />;
}
