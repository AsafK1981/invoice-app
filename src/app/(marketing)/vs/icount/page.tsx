import { ComparisonViewV2 } from "../../components/ComparisonViewV2";
import { COMPETITORS } from "@/lib/comparison-data";
import { vsMetadata } from "../vs-metadata";

const competitor = COMPETITORS.icount;

export const metadata = vsMetadata({
  path: "/vs/icount",
  title: "חשבונית סופר ידידותית vs iCount — השוואת מחירים ופיצ'רים (2026)",
  description:
    "השוואה הוגנת בין חשבונית סופר ידידותית ל-iCount — מחירים, פיצ'רים, יתרונות וחסרונות של כל צד. אצלנו חינם עכשיו בהשקה, ואח\"כ מחיר כניסה זול ושקוף.",
  keywords: [
    "iCount השוואה",
    "חלופה ל-iCount",
    "iCount alternative",
    "תוכנת חשבוניות השוואה",
    "חשבוניות אונליין",
    "עוסק פטור",
  ],
});

export default function V2VsICount() {
  return <ComparisonViewV2 competitor={competitor} />;
}
