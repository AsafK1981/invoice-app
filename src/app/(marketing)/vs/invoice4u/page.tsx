import { ComparisonViewV2 } from "../../components/ComparisonViewV2";
import { COMPETITORS } from "@/lib/comparison-data";
import { vsMetadata } from "../vs-metadata";

const competitor = COMPETITORS.invoice4u;

export const metadata = vsMetadata({
  path: "/vs/invoice4u",
  title: "חשבונית סופר ידידותית vs Invoice4U — השוואת מחירים ופיצ'רים (2026)",
  description:
    "השוואה הוגנת בין חשבונית סופר ידידותית ל-Invoice4U — מחירים, פיצ'רים, יתרונות וחסרונות של כל אחד. ₪25 לחודש ללא הגבלה מול ₪82 ב-Invoice4U.",
  keywords: [
    "Invoice4U השוואה",
    "חלופה ל-Invoice4U",
    "Invoice4U alternative",
    "תוכנת חשבוניות השוואה",
    "חשבוניות אונליין",
    "עוסק פטור",
  ],
});

export default function V2VsInvoice4U() {
  return <ComparisonViewV2 competitor={competitor} />;
}
