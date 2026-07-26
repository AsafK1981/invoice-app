import { ComparisonViewV2 } from "../../components/ComparisonViewV2";
import { COMPETITORS } from "@/lib/comparison-data";
import { vsMetadata } from "../vs-metadata";

const competitor = COMPETITORS.ezcount;

export const metadata = vsMetadata({
  path: "/vs/ezcount",
  title: "חשבונית סופר ידידותית vs EZcount — השוואת מחירים ופיצ׳רים (2026)",
  description:
    "השוואה הוגנת בין חשבונית סופר ידידותית ל-EZcount (מבית Hyp) — מחירים, פיצ׳רים ויתרונות של כל צד. אצלנו חינם עכשיו בהשקה, ואח\"כ מחיר כניסה תחרותי.",
  keywords: [
    "EZcount השוואה",
    "חלופה ל-EZcount",
    "EZcount alternative",
    "Hyp חשבוניות",
    "תוכנת חשבוניות השוואה",
    "עוסק פטור",
  ],
});

export default function V2VsEZcount() {
  return <ComparisonViewV2 competitor={competitor} />;
}
