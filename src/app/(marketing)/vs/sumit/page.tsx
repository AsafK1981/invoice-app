import { ComparisonViewV2 } from "../../components/ComparisonViewV2";
import { COMPETITORS } from "@/lib/comparison-data";
import { vsMetadata } from "../vs-metadata";

const competitor = COMPETITORS.sumit;

export const metadata = vsMetadata({
  path: "/vs/sumit",
  title: "חשבונית סופר ידידותית vs SUMIT: השוואת מחירים ופיצ׳רים (2026)",
  description:
    "השוואה הוגנת בין חשבונית סופר ידידותית ל-SUMIT: מסלול חינם, מחירים, פיצ׳רים ויתרונות של כל צד. אצלנו חינם עכשיו בהשקה, ואחר כך מהזול בקטגוריה.",
  keywords: [
    "SUMIT השוואה",
    "חלופה ל-SUMIT",
    "SUMIT alternative",
    "תוכנת חשבוניות השוואה",
    "חשבוניות אונליין",
    "עוסק פטור",
  ],
});

export default function V2VsSumit() {
  return <ComparisonViewV2 competitor={competitor} />;
}
