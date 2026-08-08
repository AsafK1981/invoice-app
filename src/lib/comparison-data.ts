/**
 * Real pricing + feature data for the /vs/* comparison pages.
 *
 * Pricing sourced 2026-05-07 from each vendor's pricing page:
 *   Invoice4U:    https://www.invoice4u.co.il/pricelist-invoice/
 *   Greeninvoice: https://www.greeninvoice.co.il/pricing
 *
 * Keep this honest. Where a competitor has a real edge, list it.
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
  slug: "invoice4u" | "greeninvoice" | "ifreelance" | "sumit" | "icount" | "ezcount";
  name: string;
  tagline: string;
  url: string;
  founded: string;
  /** One-liner about who they're best for */
  bestFor: string;
  pricing: PricingTier[];
  freeTrial: string;
  features: FeatureRow[];
  /** Where they legitimately win, be honest */
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
    note: theirNotes.gdpr ?? "אין אפשרות עצמאית להוריד את כל הנתונים, דורש פנייה לתמיכה",
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
    us: "yes",
    them: theirSupport.allocationApi ?? "yes",
    note: theirNotes.allocationApi,
  },
];

export const COMPETITORS: Record<Competitor["slug"], Competitor> = {
  invoice4u: {
    slug: "invoice4u",
    name: "Invoice4U",
    tagline: "תוכנת חשבוניות ותיקה לעסקים צומחים",
    url: "https://www.invoice4u.co.il",
    founded: "2010",
    bestFor: "עסקים בינוניים שכבר משתמשים במערכת ולא רוצים להחליף",
    pricing: [
      { name: "המסלול הוורוד", priceMonthly: 19, docs: "50 / חודש", businesses: "2" },
      { name: "המסלול הירוק", priceMonthly: 27, docs: "100 / חודש", businesses: "3" },
      { name: "המסלול הכחול", priceMonthly: 44, docs: "200 / חודש", businesses: "5" },
      { name: "המסלול האדום", priceMonthly: 82, docs: "500 / חודש", businesses: "5" },
      { name: "ללא הגבלה", priceMonthly: 59, docs: "ללא הגבלה (עד 1,000 / חודש)", businesses: "לא צוין", notes: "כולל סליקת אשראי" },
    ],
    freeTrial: "60 ימי ניסיון חינם",
    features: SHARED_FEATURES(
      {
        allocationApi: "yes",
        pwa: "no",
      },
      {
        pwa: "אתר רספונסיבי, לא PWA מותקן",
      },
    ),
    theirStrengths: [
      "60 ימי ניסיון, הכי ארוכים בשוק",
      "אינטגרציות מובנות לסליקת אשראי (Cardcom + Tranzila)",
      "אינטגרציה ישירה ל-API חשבונית ישראל (הקצאת מספרים אוטומטית)",
      "מערכת בוגרת: קיימת מאז 2010, יציבה",
      "תמיכה במגוון רחב של סוגי מסמכים (כולל הצעת מחיר ומסמכי זיכוי)",
    ],
    ourStrengths: [
      "ממשק מודרני, מהיר, נקי. בלי הצפה של תפריטים ושדות מיותרים",
      "זול יותר במסלול הבסיסי (₪15 מול ₪19), ותמורה גדולה בהרבה במסלול ה-Pro (₪25 ללא הגבלה לעומת ₪82 אצלם)",
      "Pro ב-₪25 כולל הכל ללא הגבלה. באותו מחיר ב-Invoice4U אתה מקבל רק 100 מסמכים בחודש",
      "ייצוא GDPR מלא של כל הנתונים בקליק אחד",
      "PWA אמיתי, אפליקציה מותקנת בטלפון",
      "מחיקת חשבון עצמאית: אתה שולט בנתונים שלך",
      "פוקוס בלעדי על עוסק פטור / מורשה ישראלי (Invoice4U רחבים יותר, פחות ממוקדים)",
    ],
    verdict:
      "Invoice4U ותיקים ובוגרים, עם אינטגרציות סליקה חזקות. אם זה מה שאתה צריך, הם בחירה סבירה לגמרי. אנחנו מהירים יותר, נקיים יותר וממוקדים בעצמאי הישראלי. ואצלנו חינם עכשיו בתקופת ההשקה, בלי כרטיס אשראי.",
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
        pwa: "אתר רספונסיבי, לא PWA מותקן",
        allocationApi: "אינטגרציה מלאה לחשבונית ישראל, ממסלול Best ומעלה",
      },
    ),
    theirStrengths: [
      "API מקיף למפתחים, אינטגרציות עם הרבה מערכות חיצוניות",
      "אינטגרציה למערכות תשלום (Bit, אשראי, ארנקים דיגיטליים) במסלולים בינוניים ומעלה",
      "תמיכה בכמה עסקים בחשבון אחד (Best=2, Extra=3, Prime=5)",
      "מוניטין חזק בקהילת רואי החשבון",
      "תמיכה מלאה בעברית וממשק מותאם לשוק הישראלי",
    ],
    ourStrengths: [
      "אותם פיצ׳רים, זול פי 3.5: Pro ב-₪25 מול Extra ב-₪89 (בהשוואה למשתמש יחיד)",
      "20 מסמכים בלבד במסלול הבסיסי שלהם, אצלנו 30 באותו טווח מחיר",
      "ללא הגבלת מסמכים ב-Pro, אצלם זה רק במסלול Prime ב-₪155",
      "ממשק חדש ומהיר. חשבונית ירוקה מוערכת אבל מסורבלת למשתמש מתחיל",
      "ייצוא GDPR + מחיקת חשבון בלחיצת כפתור, בלי לפנות לתמיכה",
      "עברית מלאה ו-RTL מקצועי, לא תרגום חלקי",
      "חינם עכשיו בתקופת ההשקה: כל הפיצ׳רים, בלי כרטיס אשראי",
    ],
    verdict:
      "חשבונית ירוקה מצוינת אם אתה צריך API ואינטגרציות עמוקות ומוכן לשלם ₪89-155 לחודש. אם אתה עצמאי שרוצה את כל הפיצ׳רים בלי הסיבוך, כאן יהיה לך פשוט יותר. ואצלנו חינם עכשיו בתקופת ההשקה, בלי כרטיס אשראי.",
  },
  ifreelance: {
    slug: "ifreelance",
    name: "iFreelance",
    tagline: "תוכנת חשבוניות לפרילנסרים, פעילה משנת 2010",
    url: "https://ifree.ifreelance.co.il",
    founded: "2010",
    bestFor:
      "עצמאים שרוצים סליקת אשראי מובנית + רואה חשבון משולב בתשלום נמוך",
    pricing: [
      { name: "חודשי", priceMonthly: 26, docs: "ללא הגבלה", businesses: "לא צוין", notes: "כל הפיצ׳רים כלולים" },
      {
        name: "שנתי",
        priceMonthly: 19,
        docs: "ללא הגבלה",
        businesses: "לא צוין",
        notes: "₪228 בשנה",
      },
      {
        name: "רואה חשבון אישי",
        priceMonthly: 100,
        docs: "ללא הגבלה",
        businesses: "לא צוין",
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
          "לא ברור אם ניתן עצמאית, חלק מהמתחרים דורשים פנייה לתמיכה",
      },
    ),
    theirStrengths: [
      "תמחור אגרסיבי: ₪19/חודש (שנתי) לכל הפיצ׳רים, אחד מהזולים בשוק",
      "סליקת אשראי מובנית בתוכנה: 0.95% (כולל Bit, Apple Pay, כרטיס אשראי)",
      "60 ימי ניסיון, מהארוכים בשוק",
      "תוכנית 'רואה חשבון אישי' (₪100/חודש): שילוב תוכנה + ייעוץ מקצועי",
      "שירותים נוספים בתשלום חד-פעמי: רישום עסק, הצהרת הון, דוחות שנתיים",
      "פעילה משנת 2010, בוגרת ויציבה",
      "אינטגרציה ל-API חשבונית ישראל (הקצאת מספרים אוטומטית)",
    ],
    ourStrengths: [
      "עיצוב מודרני ומהיר. האתר שלהם עדיין נראה כמו 2010, שלנו נבנה ב-2026",
      "PWA אמיתי, מותקן כאפליקציה אמיתית בטלפון, לא רק רספונסיבי",
      "תמיכת לקוחות גמישה, לא רק 09:00-14:00 בימי חול",
      "התראת תקרת עוסק פטור בזמן אמת, לא רק תצוגת הכנסות",
      "ייצוא GDPR + מחיקת חשבון עצמאית בלחיצת כפתור, שליטה מלאה בנתונים",
      "ריבוי עסקים בחשבון אחד (Pro)",
      "דף סטטוס ציבורי + שקיפות מלאה על זמינות השירות",
      "עוזר AI בעברית בתוך האפליקציה: מוצא מסמכים, עונה על שאלות הכנסות ומכין טיוטות לאישורך",
      "מסלולים שקופים ופשוטים: מסלול בסיסי במחיר נמוך, Pro למי שצריך הכל",
    ],
    verdict:
      "iFreelance זולים ועשירים בפיצ׳רים, במיוחד עם הסליקה המובנית. אם המחיר הוא הקריטריון היחיד, הם תחרות אמיתית. אנחנו מביאים חוויית מובייל מודרנית יותר ושקיפות מלאה, ולמי שרק מתחיל, נראה מקצועיים יותר מול הלקוח. ואצלנו חינם עכשיו בתקופת ההשקה, בלי כרטיס אשראי.",
  },
  sumit: {
    slug: "sumit",
    name: "SUMIT",
    tagline: "מערכת חשבוניות והנהלת חשבונות עם מסלול חינם (freemium)",
    url: "https://www.sumit.co.il",
    founded: "לא צוין",
    bestFor:
      "מי שרוצה להתחיל בחינם ולגדול בהדרגה, ומעדיף אקוסיסטם רחב של חשבוניות, סליקה וגבייה",
    pricing: [
      {
        name: "חינם",
        priceMonthly: 0,
        docs: "~10 פעולות / חודש",
        businesses: "1",
        notes: "מסלול חינם קבוע (freemium)",
      },
      {
        name: "בתשלום, החל מ־",
        priceMonthly: 19,
        docs: "לפי היקף פעולות",
        businesses: "לא צוין",
        notes: "מדרגות מחיר עולות לפי היקף",
      },
    ],
    freeTrial: "מסלול חינם קבוע, עד ~10 פעולות בחודש (freemium)",
    features: SHARED_FEATURES(
      {
        allocationApi: "yes",
        pwa: "partial",
        gdpr: "unknown",
        deleteAccount: "unknown",
        statusPage: "unknown",
      },
      {
        pwa: "אתר רספונסיבי",
        gdpr: "לא מצאנו נתון מאומת",
        deleteAccount: "לא מצאנו נתון מאומת",
        statusPage: "לא מצאנו נתון מאומת",
      },
    ),
    theirStrengths: [
      "מסלול חינם אמיתי, אפשר להתחיל בלי לשלם (עד ~10 פעולות בחודש)",
      "אקוסיסטם רחב: חשבוניות, סליקת אשראי, גבייה ו-CRM באותה מערכת",
      "מגובה בקבוצת סליקה/פינטק גדולה, יציבות ותשתית תשלומים",
      "אינטגרציה ל-API חשבונית ישראל (הקצאת מספרים אוטומטית)",
    ],
    ourStrengths: [
      "ממשק ממוקד ונקי לעוסק פטור/מורשה, בלי עומס של מודולים שלא צריך",
      "חינם עכשיו בתקופת ההשקה: כל הפיצ׳רים, ואחריה המחיר הזול בקטגוריה (₪15 בסיסי)",
      "מחיר עתידי שקוף ופשוט: בסיסי ₪15, Pro ₪25 ללא הגבלה, בלי לספור 'פעולות'",
      "PWA אמיתי, אפליקציה מותקנת בטלפון",
      "ייצוא GDPR מלא של הנתונים ומחיקת חשבון עצמאית בלחיצת כפתור",
      "פוקוס בלעדי על חשבונית ישראל, הקצאת מספרים אוטומטית מתוך המערכת",
    ],
    verdict:
      "SUMIT מצוינת אם מתאים לך אקוסיסטם רחב של חשבוניות, סליקה וגבייה, ואם חשוב לך להתחיל ממסלול חינם. אנחנו ממוקדים ופשוטים יותר לעוסק, בלי לספור 'פעולות'. ואצלנו חינם עכשיו בתקופת ההשקה, בלי כרטיס אשראי.",
  },
  icount: {
    slug: "icount",
    name: "iCount",
    tagline: "מערכת חשבוניות והנהלת חשבונות ותיקה עם קהילת רו״ח גדולה",
    url: "https://www.icount.co.il",
    founded: "לא צוין",
    bestFor: "עסקים שרוצים מערכת ותיקה ומוכרת עם עורף רואי חשבון רחב",
    pricing: [
      {
        name: "מסלול בסיס",
        priceMonthly: 23,
        docs: "חיוב שנתי · ~₪276 לשנה",
        businesses: "לא צוין",
        notes: "מחיר כניסה משוער, בחיוב שנתי",
      },
    ],
    freeTrial: "45 ימי ניסיון חינם",
    features: SHARED_FEATURES(
      {
        allocationApi: "yes",
        pwa: "partial",
        gdpr: "unknown",
        deleteAccount: "unknown",
        statusPage: "unknown",
      },
      {
        pwa: "אתר רספונסיבי",
        gdpr: "לא מצאנו נתון מאומת",
        deleteAccount: "לא מצאנו נתון מאומת",
        statusPage: "לא מצאנו נתון מאומת",
      },
    ),
    theirStrengths: [
      "ותק וניסיון, מערכת מוכרת עם עשרות אלפי משתמשים",
      "45 ימי ניסיון, מהארוכים בשוק",
      "קהילת רואי חשבון רחבה ותמיכה מקצועית מבוססת",
      "אינטגרציה ל-API חשבונית ישראל (הקצאת מספרים אוטומטית)",
      "מגוון רחב של סוגי מסמכים ודוחות הנהלת חשבונות",
    ],
    ourStrengths: [
      "ממשק חדש, מהיר ונקי מ-2026, לעומת מערכת ותיקה ועמוסה יותר",
      "חינם עכשיו בתקופת ההשקה, ואחריה מחיר כניסה זול ושקוף (₪15 בסיסי / ₪25 Pro)",
      "חיוב חודשי גמיש, בלי התחייבות שנתית מראש כדי לקבל את מחיר הכניסה",
      "PWA אמיתי, אפליקציה מותקנת בטלפון",
      "ייצוא GDPR מלא ומחיקת חשבון עצמאית בלחיצת כפתור",
      "פוקוס בלעדי על עוסק פטור/מורשה ישראלי: הקצאת מספרים מול חשבונית ישראל, מובנית במערכת",
    ],
    verdict:
      "iCount מערכת ותיקה ויציבה, עם עורף רואי-חשבון חזק ו-45 ימי ניסיון. אם בא לך כלי מהיר ונקי בלי התחייבות שנתית, כאן תרגיש בבית. ואצלנו חינם עכשיו בתקופת ההשקה, בלי כרטיס אשראי.",
  },
  ezcount: {
    slug: "ezcount",
    name: "EZcount",
    tagline: "מערכת חשבוניות זולה מבית Hyp (חברת סליקה/תשלומים גדולה)",
    url: "https://www.ezcount.co.il",
    founded: "לא צוין",
    bestFor: "מי שרוצה מערכת חשבוניות זולה מאוד עם גב של חברת סליקה גדולה",
    pricing: [
      {
        name: "מסלול בסיס",
        priceMonthly: 21,
        docs: "לפי מסלול",
        businesses: "לא צוין",
        notes: "טווח משוער ₪21-24 לחודש",
      },
    ],
    freeTrial: "תקופת ניסיון חינם (משך לא מצוין)",
    features: SHARED_FEATURES(
      {
        allocationApi: "yes",
        pwa: "partial",
        gdpr: "unknown",
        deleteAccount: "unknown",
        statusPage: "unknown",
      },
      {
        pwa: "אתר רספונסיבי",
        gdpr: "לא מצאנו נתון מאומת",
        deleteAccount: "לא מצאנו נתון מאומת",
        statusPage: "לא מצאנו נתון מאומת",
      },
    ),
    theirStrengths: [
      "מהזולים בשוק, מחיר כניסה נמוך מאוד (~₪21-24 לחודש)",
      "מגובה ב-Hyp, חברת סליקה/תשלומים גדולה, תשתית תשלומים חזקה",
      "אינטגרציה ל-API חשבונית ישראל (הקצאת מספרים אוטומטית)",
      "אינטגרציות סליקה וגבייה נוחות דרך קבוצת התשלומים",
    ],
    ourStrengths: [
      "חינם עכשיו בתקופת ההשקה, ואחריה ₪15 בסיסי, זול אף יותר מ-EZcount (₪15 מול ~₪21)",
      "ממשק מודרני, מהיר ונקי: עיצוב 2026",
      "PWA אמיתי, אפליקציה מותקנת בטלפון",
      "ייצוא GDPR מלא ומחיקת חשבון עצמאית בלחיצת כפתור",
      "Pro ₪25 ללא הגבלה, תמחור פשוט ושקוף בלי מדרגות נסתרות",
      "פוקוס בלעדי על עוסק פטור/מורשה: הקצאת מספרים מול חשבונית ישראל, מובנית במערכת",
    ],
    verdict:
      "EZcount מבית Hyp היא מהאפשרויות הזולות בשוק, עם גב של חברת סליקה גדולה. אנחנו באותו טווח מחיר, אבל עם ממשק מודרני יותר, PWA אמיתי ושליטה מלאה בנתונים. ואצלנו חינם עכשיו בתקופת ההשקה, בלי כרטיס אשראי.",
  },
};
