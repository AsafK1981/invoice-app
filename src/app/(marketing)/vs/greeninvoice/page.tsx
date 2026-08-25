import { ComparisonViewV2 } from "../../components/ComparisonViewV2";
import { COMPETITORS } from "@/lib/comparison-data";
import { vsMetadata } from "../vs-metadata";

const competitor = COMPETITORS.greeninvoice;

export const metadata = vsMetadata({
  path: "/vs/greeninvoice",
  // Title and description target the four queries Search Console shows this
  // page for (מחיר / עלות / חינם / מומלצת, position ~24-38, 0 clicks on
  // 2026-08-23). Lead with the price question, then the free alternative.
  title: "חשבונית ירוקה מחיר 2026: כל המסלולים, ומה החלופה החינמית",
  description:
    "כמה עולה חשבונית ירוקה? Basic ₪29, Best ₪54, Extra ₪89, Prime ₪155 לחודש (נבדק 8/2026). האם היא מומלצת, ואיפה מקבלים את אותם פיצ׳רים בחינם: השוואה הוגנת מול חשבונית ידידותית.",
  keywords: [
    "חשבונית ירוקה מחיר",
    "חשבונית ירוקה עלות",
    "חשבונית ירוקה חינם",
    "חשבונית ירוקה מומלצת",
    "חשבונית ירוקה השוואה",
    "חלופה לחשבונית ירוקה",
    "Greeninvoice alternative",
    "עוסק פטור",
  ],
});

export default function V2VsGreenInvoice() {
  return <ComparisonViewV2 competitor={competitor} />;
}
