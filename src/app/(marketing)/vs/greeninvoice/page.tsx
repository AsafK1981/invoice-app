import { ComparisonViewV2 } from "../../components/ComparisonViewV2";
import { COMPETITORS } from "@/lib/comparison-data";
import { vsMetadata } from "../vs-metadata";

const competitor = COMPETITORS.greeninvoice;

export const metadata = vsMetadata({
  path: "/vs/greeninvoice",
  title: "חשבונית ידידותית vs חשבונית ירוקה: השוואת מחירים ופיצ׳רים (2026)",
  description:
    "השוואה הוגנת בין חשבונית ידידותית לחשבונית ירוקה (Greeninvoice). Pro ₪25 לחודש vs Extra ₪89: אותם פיצ׳רים, פי 3.5 זול.",
  keywords: [
    "חשבונית ירוקה השוואה",
    "חלופה לחשבונית ירוקה",
    "Greeninvoice alternative",
    "תוכנת חשבוניות השוואה",
    "חשבוניות אונליין",
    "עוסק פטור",
  ],
});

export default function V2VsGreenInvoice() {
  return <ComparisonViewV2 competitor={competitor} />;
}
