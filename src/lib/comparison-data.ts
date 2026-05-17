/**
 * Real pricing + feature data for the /vs/* comparison pages.
 *
 * Pricing sourced 2026-05-07 from each vendor's pricing page:
 *   Invoice4U:    https://www.invoice4u.co.il/pricelist-invoice/
 *   Greeninvoice: https://www.greeninvoice.co.il/pricing
 *
 * Keep this honest. Where a competitor has a real edge — list it.
 * Spin gets seen through in seconds; fair comparisons get trusted.
 */

export type FeatureSupport = "yes" | "no" | "partial" | "unknown";

export interface PricingTier {
  name: string;
  priceMonthly: number; // NIS
  docs: string; // e.g. "50 / month"
  businesses: string; // e.g. "2"
  notes?: string;
}

export interface FeatureRow {
  feature: string;
  us: FeatureSupport;
  them: FeatureSupport;
  note?: string;
}

export interface Competitor {
  slug: "invoice4u" | "greeninvoice" | "ifreelance";
  name: string;
  tagline: string;
  url: string;
  founded: string;
  /** One-liner about who they're best for */
  bestFor: string;
  pricing: PricingTier[];
  freeTrial: string;
  features: FeatureRow[];
  /** Where they legitimately win — be honest */
  theirStrengths: string[];
  /** Where we legitimately win */
  ourStrengths: string[];
  /** Short verdict shown in hero */
  verdict: string;
}

const SHARED_FEATURES = (theirSupport: Record<string, FeatureSupport>, theirNotes: Record<string, string> = {}): FeatureRow[] => [
  {
    feature: "ניהול לקוחות וקטלוג מוצרים",
    us: "yes",
    them: theirSupport.clients ?? "yes",
    note: theirNotes.clients,
  },
  {
    feature: "הפקת קבלות וחשבונות עסקה",
    us: "yes",
    them: theirSupport.receipts ?? "yes",
  },
  {
    feature: "חשבונית מס (לעוסק מורשה)",
    us: "yes",
    them: theirSupport.taxInvoice ?? "yes",
  },
  {
    feature: "שליחת מסמך ללקוח במייל",
    us: "yes",
    them: theirSupport.emailSend ?? "yes",
  },
  {
    feature: "PDF להורדה והדפסה",
    us: "yes",
    them: theirSupport.pdf ?? "yes",
  },
  {
    feature: "דשבורד עם גרפים",
    us: "yes",
    them: theirSupport.dashboard ?? "yes",
  },
  {
    feature: "מעקב הכנסות והוצאות",
    us: "yes",
    them: theirSupport.expenses ?? "yes",
  },
  {
    feature: "ייצוא לאקסל / CSV",
    us: "yes",
    them: theirSupport.csv ?? "yes",
  },
  {
    feature: "ייבוא לקוחות אוטומטי",
    us: "yes",
    them: theirSupport.csvImport ?? "yes",
  },
  {
    feature: "התראת תקרת עוסק פטור",
    us: "yes",
    them: theirSupport.exemptCeiling ?? "partial",
    note: theirNotes.exemptCeiling ?? "מציגים את ההכנסות אבל לא מתריעים בזמן אמת",
  },
  {
    feature: "ייצוא GDPR (כל הנתונים שלך, בקובץ אחד)",
    us: "yes",
    them: theirSupport.gdpr ?? "no",
    note: theirNotes.gdpr ?? "אין אפשרות עצמאית להוריד את כל הנתונים — דורש פנייה לתמיכה",
  },
  {
    feature: "מחיקת חשבון עצמאית",
    us: "yes",
    them: theirSupport.deleteAccount ?? "no",
    note: theirNotes.deleteAccount ?? "פנייה בכתב לתמיכה",
  },
  {
    feature: "דף סטטוס ציבורי + בקרת תקלות",
    us: "yes",
    them: theirSupport.statusPage ?? "no",
  },
  {
    feature: "אפליקציה מותקנת בטלפון (PWA)",
    us: "yes",
    them: theirSupport.pwa ?? "partial",
    note: theirNotes.pwa,
  },
  {
    feature: "אינטגרציה ל-API \"חשבונית ישראל\" (הקצאת מספרים)",
    us: "partial",
    them: theirSupport.allocationApi ?? "yes",
    note: theirNotes.allocationApi ?? "כרגע ידני, בפיתוח לפיצ׳ר אוטומטי",
  },
];

export const COMPETITORS: Record<Competitor["slug"], Competitor> = {
  invoice4u: {
    slug: "invoice4u",
    name: "Invoice4U",
    tagline: "תוכנת חשבוניות וותיקה לעסקים צומחים",
    url: "https://www.invoice4u.co.il",
    founded: "2010",
    bestFor: "עסקים בינוניים שכבר משתמשים במערכת ולא רוצים להחליף",
    pricing: [
      { name: "המסלול הורוד", priceMonthly: 19, docs: "50 / חודש", businesses: "2" },
      { name: "המסלול הירוק", priceMonthly: 27, docs: "100 / חודש", businesses: "3" },
      { name: "המסלול הכחול", priceMonthly: 44, docs: "200 / חודש", businesses: "5" },
      { name: "המסלול האדום", priceMonthly: 82, docs: "500 / חודש", businesses: "5" },
      { name: "ללא הגבלה", priceMonthly: 59, docs: "ללא הגבלה (עד 1,000 / חודש)", businesses: "—", notes: "כולל סליקת אשראי" },
    ],
    freeTrial: "60 ימי ניסיון חינם",
    features: SHARED_FEATURES(
      {
        allocationApi: "yes",
        pwa: "no",
      },
      {
        pwa: "אתר Responsive, לא PWA מותקן",
      },
    ),
    theirStrengths: [
      "60 ימי ניסיון — הכי ארוכים בשוק",
      "אינטגרציות מובנות לסליקת אשראי (Cardcom + Tranzila)",
      "אינטגרציה ישירה ל-API חשבונית ישראל (הקצאת מספרים אוטומטית)",
      "מערכת בוגרת — קיימת מאז 2010, יציבה",
      "תמיכה במגוון רחב של סוגי מסמכים (כולל הצעת מחיר ומסמכי זיכוי)",
    ],
    ourStrengths: [
      "ממשק מודרני, מהיר, נקי — בלי הצפה של תפריטים ושדות מיותרים",
      "אותו מחיר במסלול הבסיסי (₪19) — לקבל יותר במסלול ה-Pro (₪29 ללא הגבלה לעומת ₪82 אצלם)",
      "Pro ב-₪29 כולל הכל ללא הגבלה — באותו מחיר אתה ב-Invoice4U מקבל רק 100 מסמכים בחודש",
      "ייצוא GDPR מלא של כל הנתונים בקליק אחד",
      "PWA אמיתי — אפליקציה מותקנת בטלפון",
      "מחיקת חשבון עצמאית — אתה שולט על הנתונים שלך",
      "פוקוס בלעדי על עוסק פטור / מורשה ישראלי (Invoice4U רחבים יותר, פחות ממוקדים)",
    ],
    verdict:
      "Invoice4U בוגרים יותר עם אינטגרציות מערכות סליקה אם זה צריך לך. אנחנו מהירים יותר, נקיים יותר, ועשירים יותר בפיצ׳רים באותו מחיר — במיוחד אם המשרד שלך קטן ואתה רוצה ערך מקסימלי בפחות מ-₪50 לחודש.",
  },
  greeninvoice: {
    slug: "greeninvoice",
    name: "חשבונית ירוקה",
    tagline: "פלטפורמת חשבוניות פופולרית עם API מקיף",
    url: "https://www.greeninvoice.co.il",
    founded: "2014",
    bestFor: "עסקים שצריכים API נרחב לאינטגרציה עם CRM / ERP / חנויות אונליין",
    pricing: [
      { name: "Basic", priceMonthly: 29, docs: "20 / חודש", businesses: "1" },
      { name: "Best", priceMonthly: 54, docs: "50 / חודש", businesses: "2", notes: "כולל סליקה ו-API" },
      { name: "Extra", priceMonthly: 89, docs: "200 / חודש", businesses: "3" },
      { name: "Prime", priceMonthly: 155, docs: "500 / חודש", businesses: "5" },
    ],
    freeTrial: "תקופת ניסיון חינם (לא מצוין משך)",
    features: SHARED_FEATURES(
      {
        allocationApi: "yes",
        pwa: "no",
      },
      {
        pwa: "אתר Responsive, לא PWA מותקן",
        allocationApi: "אינטגרציה מלאה ל-חשבונית ישראל מסלול Best ומעלה",
      },
    ),
    theirStrengths: [
      "API מקיף ל-developers — אינטגרציות עם הרבה מערכות חיצוניות",
      "אינטגרציה למערכות תשלום (Bit, אשראי, ארנקים דיגיטליים) במסלולים בינוניים ומעלה",
      "תמיכה במספר רב של עסקים בחשבון אחד (Best=2, Extra=3, Prime=5)",
      "מוניטין חזק בקהילת רואי החשבון",
      "תמיכה בעברית ובהזמנת תיק לקוחות בגוגל",
    ],
    ourStrengths: [
      "אותם הפיצ׳רים, פי 3 פחות כסף — Pro ₪29 vs Extra ₪89 (כשהפיצ׳רים זהים פר-משתמש יחיד)",
      "20 מסמכים בלבד במסלול הבסיסי שלהם — אצלנו 30 באותו טווח מחיר",
      "ללא הגבלת מסמכים ב-Pro — אצלם זה רק במסלול Prime ב-₪155",
      "ממשק חדש ומהיר — חשבונית ירוקה מוערך אבל מסורבל למשתמש מתחיל",
      "ייצוא GDPR + מחיקת חשבון בכפתור — לא דורש לדבר עם תמיכה",
      "תרגום מלא + RTL מקצועי — לא רק חלקי",
      "14 ימי ניסיון, ללא כרטיס אשראי — שקיפות מלאה לפני שמשלמים",
    ],
    verdict:
      "חשבונית ירוקה חזקה אם אתה צריך API ואינטגרציות ומוכן לשלם ₪89-155 לחודש. אם אתה עצמאי שרוצה את כל הפיצ׳רים בלי הקסה — Pro ב-₪29 שלנו הוא פי 3 זול יותר ומספק את אותו הצורך.",
  },
  ifreelance: {
    slug: "ifreelance",
    name: "iFreelance",
    tagline: "תוכנת חשבוניות לפרילנסרים, פעילה משנת 2010",
    url: "https://ifree.ifreelance.co.il",
    founded: "2010",
    bestFor:
      "עצמאיים שרוצים סליקת אשראי מובנית + רואה חשבון משולב בתשלום נמוך",
    pricing: [
      { name: "חודשי", priceMonthly: 26, docs: "ללא הגבלה", businesses: "—", notes: "כל הפיצ׳רים כלולים" },
      {
        name: "שנתי",
        priceMonthly: 19,
        docs: "ללא הגבלה",
        businesses: "—",
        notes: "₪228 בשנה",
      },
      {
        name: "רואה חשבון אישי",
        priceMonthly: 100,
        docs: "ללא הגבלה",
        businesses: "—",
        notes: "כולל תוכנה + ייעוץ מקצועי + פגישות רבעוניות",
      },
    ],
    freeTrial: "60 ימי ניסיון חינם (כל המודולים)",
    features: SHARED_FEATURES(
      {
        allocationApi: "yes",
        pwa: "partial",
        deleteAccount: "unknown",
        gdpr: "unknown",
        statusPage: "no",
      },
      {
        pwa: "אתר רספונסיבי, ייתכן מצב 'קיצור דרך' למובייל",
        deleteAccount:
          "לא ברור אם ניתן עצמאית — חלק מהמתחרים דורשים פנייה לתמיכה",
      },
    ),
    theirStrengths: [
      "תמחור אגרסיבי — ₪19/חודש (שנתי) לכל הפיצ׳רים, אחד מהזולים בשוק",
      "סליקת אשראי מובנית מהתוכנה — 0.95% (כולל Bit, Apple Pay, כרטיס אשראי)",
      "60 ימי ניסיון — פי 4 משלנו, ארוך משמעותית גם מהמתחרים",
      "תוכנית 'רואה חשבון אישי' (₪100/חודש) — שילוב תוכנה + ייעוץ מקצועי",
      "שירותים נוספים בתשלום חד-פעמי — רישום עסק, הצהרת הון, דוחות שנתיים",
      "פעילה משנת 2010 — בוגרת ויציבה",
      "אינטגרציה ל-API חשבונית ישראל (הקצאת מספרים אוטומטית)",
    ],
    ourStrengths: [
      "עיצוב מודרני ומהיר — האתר שלהם בעל וייב 'ישן' מ-2010, שלנו מודרני מ-2026",
      "PWA אמיתי — מותקן כאפליקציה אמיתית בטלפון, לא רק רספונסיבי",
      "תמיכה לקוחות גמישה — לא רק 09:00-14:00 בימי חול",
      "התראת תקרת עוסק פטור בזמן אמת — לא רק תצוגת הכנסות",
      "ייצוא GDPR + מחיקת חשבון עצמאית בכפתור — שליטה מלאה על הנתונים",
      "ריבוי עסקים בחשבון אחד (Pro)",
      "דף סטטוס ציבורי + שקיפות מלאה של uptime",
      "אזרי-AI: עזרה חכמה לזיהוי קטגוריות, השלמת לקוחות, התראות חכמות (בפיתוח)",
      "מסלולים שקופים ופשוטים — מסלול בסיסי במחיר נמוך, Pro למי שצריך הכל",
    ],
    verdict:
      "iFreelance זול ועשיר בפיצ׳רים, במיוחד עם סליקה מובנית. אם המחיר הוא הקריטריון היחיד — הם תחרות אמיתית. אנחנו עדיפים על UX, מובייל, ושקיפות — ובקרוב גם על שילוב תשלומים. למי שמתחיל ורוצה כלי נקי וחווייתי, נצא מקצועיים יותר.",
  },
};
