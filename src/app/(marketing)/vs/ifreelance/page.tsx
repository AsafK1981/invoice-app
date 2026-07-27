import { ComparisonViewV2 } from "../../components/ComparisonViewV2";
import { COMPETITORS } from "@/lib/comparison-data";
import { vsMetadata } from "../vs-metadata";

const competitor = COMPETITORS.ifreelance;

export const metadata = vsMetadata({
  path: "/vs/ifreelance",
  title: "חשבונית סופר ידידותית vs iFreelance: השוואת מחירים ופיצ׳רים (2026)",
  description:
    "השוואה הוגנת בין חשבונית סופר ידידותית ל-iFreelance: מחירים, פיצ׳רים, יתרונות וחסרונות של כל אחד. ₪19-26 לחודש לעומת ₪15-25 שלנו, אבל עם UX מודרני יותר.",
  keywords: [
    "iFreelance השוואה",
    "חלופה ל-iFreelance",
    "iFreelance alternative",
    "תוכנת חשבוניות השוואה",
    "חשבוניות אונליין",
    "עוסק פטור",
    "פרילנסר חשבוניות",
  ],
});

export default function V2VsIFreelance() {
  return <ComparisonViewV2 competitor={competitor} />;
}
