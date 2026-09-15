// Filing obligations calendar: what an Israeli freelancer files, when, where
// and how. Pure data + date arithmetic, no React, so the /obligations page,
// the dashboard card, the reminder cron and the periodic report all share one
// definition of "when is the August VAT report due".
//
// Sources (verified 2026-09-15, see docs/research/2026-09-15-filing-obligations.md):
// - Tax Authority notice "קביעת מועדי הדיווח והתשלום - דוחות תקופתיים מע"מ,
//   מקדמות מס הכנסה וניכויים מס הכנסה - שנת המס 2026", published 15.10.2025,
//   https://www.gov.il/he/pages/pa151025-2 (read in a real browser). By law the
//   periodic VAT report and income-tax advances are due on the 15th, deductions
//   on the 16th and the detailed VAT report on the 23rd; the notice moves each
//   month's date for rest days and holidays and lists the result per month.
// - Section 4 of that notice: a statutory date on Friday, Saturday or Sunday
//   moves to the following Monday. Used only for months the notice does not list.
// - Exempt dealer annual declaration: 31 January (תקנה 15 לתקנות מע"מ רישום), kolzchut.
// - Annual income tax report: 30 April after the tax year by law; the Authority
//   usually announces an extension (tax year 2025 was extended to 30.6.2026 for
//   online filers), so the page says "check for an extension".
// - National insurance advances: the 15th of the month, or the 22nd by standing
//   order (kolzchut, "דרכים לתשלום דמי הביטוח הלאומי").
// - Mandatory pension deposit for the self-employed: by 31 December of the year.

import type { Business } from "../types";

export type Authority = "vat" | "tax" | "btl";

export type ObligationId =
  | "vat_periodic"
  | "vat_detailed"
  | "income_tax_advance"
  | "withholding"
  | "exempt_declaration"
  | "annual_report"
  | "btl_advance"
  | "pension_deposit";

export type Cadence = "monthly" | "bimonthly";

/** What the user tells us once; defaults are the most common case. */
export interface FilingPreferences {
  /** מע"מ reporting cadence (מורשה only). Bi-monthly up to the turnover threshold. */
  vatCadence: Cadence;
  /** מקדמות cadence, as printed on the פנקס מקדמות. */
  advanceCadence: Cadence;
  /** Whether the business must file the detailed VAT report (PCN874). */
  detailedReporter: boolean;
  /** Only with employees: monthly deductions report. */
  hasEmployees: boolean;
}

export const DEFAULT_FILING_PREFERENCES: FilingPreferences = {
  vatCadence: "bimonthly",
  advanceCadence: "bimonthly",
  detailedReporter: false,
  hasEmployees: false,
};

/** Official dates per reporting month, from the Tax Authority's 2026 notice. */
interface OfficialMonth {
  /** Periodic VAT report and income-tax advances. */
  periodic: string;
  /** Deductions (ניכויים). */
  withholding: string;
  /** Detailed VAT report (PCN874). */
  detailed: string;
}

export const OFFICIAL_DEADLINES: Record<string, OfficialMonth> = {
  "2026-01": { periodic: "2026-02-16", withholding: "2026-02-16", detailed: "2026-02-23" },
  "2026-02": { periodic: "2026-03-16", withholding: "2026-03-16", detailed: "2026-03-26" },
  "2026-03": { periodic: "2026-04-27", withholding: "2026-04-27", detailed: "2026-04-27" },
  "2026-04": { periodic: "2026-05-18", withholding: "2026-05-18", detailed: "2026-05-26" },
  "2026-05": { periodic: "2026-06-15", withholding: "2026-06-16", detailed: "2026-06-23" },
  "2026-06": { periodic: "2026-07-15", withholding: "2026-07-16", detailed: "2026-07-27" },
  "2026-07": { periodic: "2026-08-17", withholding: "2026-08-17", detailed: "2026-08-24" },
  "2026-08": { periodic: "2026-09-24", withholding: "2026-09-24", detailed: "2026-09-24" },
  "2026-09": { periodic: "2026-10-19", withholding: "2026-10-19", detailed: "2026-10-26" },
  "2026-10": { periodic: "2026-11-16", withholding: "2026-11-16", detailed: "2026-11-23" },
  "2026-11": { periodic: "2026-12-15", withholding: "2026-12-16", detailed: "2026-12-23" },
  "2026-12": { periodic: "2027-01-18", withholding: "2027-01-18", detailed: "2027-01-26" },
};

export const OFFICIAL_CALENDAR_URL = "https://www.gov.il/he/pages/pa151025-2";

const pad2 = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;

/** Day of week (0 = Sunday) for an ISO date, independent of the machine's timezone. */
function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDaysIso(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Section 4 of the notice: Friday, Saturday or Sunday moves to Monday. Holidays are NOT modelled. */
export function shiftOffRestDay(date: string): string {
  const w = weekday(date);
  if (w === 5) return addDaysIso(date, 3);
  if (w === 6) return addDaysIso(date, 2);
  if (w === 0) return addDaysIso(date, 1);
  return date;
}

export interface Deadline {
  date: string;
  /**
   * Last day when reporting AND paying online on the Tax Authority's site
   * (periodic VAT and advances only): the 19th of that month, or the table
   * date when that is later. Both service pages state it verbatim (verified
   * 2026-09-15): "את הדוחות התקופתיים שמוגשים באופן מקוון, ניתן לדווח ולשלם עד
   * ל-19 בכל חודש" and "דיווח שיוגש עד ה-19 לחודש בשעה 18:30 ייחשב דיווח במועד".
   */
  onlineDate?: string;
  /** True when the date comes from the Authority's published table; false = statutory day + weekend rule only. */
  official: boolean;
}

/** "2026-08" -> the month after, as [year, month]. */
function nextMonth(ym: string): [number, number] {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 12 ? [y + 1, 1] : [y, m + 1];
}

/**
 * The deadline of a periodic filing whose reporting period ends in month `ym`
 * ("2026-08"). A bi-monthly period is reported with its LAST month, so
 * July-August 2026 is due with the "August" row.
 */
export function periodicDeadline(kind: keyof OfficialMonth, ym: string): Deadline {
  const [y, m] = nextMonth(ym);
  const row = OFFICIAL_DEADLINES[ym];
  const day = kind === "periodic" ? 15 : kind === "withholding" ? 16 : 23;
  const date = row ? row[kind] : shiftOffRestDay(iso(y, m, day));
  if (kind !== "periodic") return { date, official: !!row };
  const nineteenth = iso(y, m, 19);
  return { date, onlineDate: date > nineteenth ? date : nineteenth, official: !!row };
}

export interface ObligationInfo {
  id: ObligationId;
  authority: Authority;
  title: string;
  /** Two or three words for a calendar chip, where the full title would be cut. */
  short: string;
  cadenceText: string;
  what: string;
  when: string;
  how: string;
  /** Official service page. */
  whereLabel: string;
  whereUrl: string;
  /** In-app report that prepares the figures, when one exists. */
  appHref?: string;
  appLabel?: string;
  /** Who this applies to, shown when it is conditional. */
  appliesNote?: string;
}

export const AUTHORITY_LABELS: Record<Authority, string> = {
  vat: "מע״מ",
  tax: "מס הכנסה",
  btl: "ביטוח לאומי",
};

export const OBLIGATIONS: Record<ObligationId, ObligationInfo> = {
  vat_periodic: {
    id: "vat_periodic",
    authority: "vat",
    title: "דוח מע״מ תקופתי",
    short: "דוח מע״מ",
    cadenceText: "כל חודשיים, או כל חודש לעסק עם מחזור גבוה",
    what: "שש ספרות: עסקאות חייבות ומס עסקאות, עסקאות פטורות או בשיעור אפס, מס תשומות ציוד, מס תשומות אחרות, והסכום לתשלום או להחזר.",
    when: "ב-15 בחודש שאחרי התקופה, ובדיווח ותשלום באתר עד ה-19. כשהמועד חל בסוף שבוע או בחג רשות המסים דוחה אותו, והתאריך כאן כבר כולל את הדחייה.",
    how: "נכנסים לשירות עם שם משתמש וסיסמה של האזור האישי ברשות המסים, או בכרטיס חכם, מקלידים את שש הספרות ומשלמים.",
    whereLabel: "דיווח ותשלום של דוחות מע״מ",
    whereUrl: "https://www.gov.il/he/service/reporting-or-payment-of-vat-reports",
    appHref: "/reports/periodic",
    appLabel: "פתח את הדוח התקופתי המוכן",
  },
  vat_detailed: {
    id: "vat_detailed",
    authority: "vat",
    title: "דיווח מפורט למע״מ (PCN874)",
    short: "דיווח מפורט",
    cadenceText: "באותה תדירות של דוח המע״מ",
    what: "קובץ עם פירוט החשבוניות של התקופה, מכירות ותשומות.",
    when: "ב-23 בחודש שאחרי התקופה, כולל הדחיות שרשות המסים קבעה.",
    how: "מורידים את קובץ PCN874 מהאפליקציה ומעלים אותו בשירות הדיווח המפורט.",
    whereLabel: "הגשת דיווח מפורט למע״מ",
    whereUrl: "https://www.gov.il/he/service/detailed-vat-reporting",
    appHref: "/reports/vat",
    appLabel: "הורד את קובץ PCN874",
    appliesNote: "רק לעסק שחייב בדיווח מפורט. מ-2026 החובה חלה גם על עוסק יחיד עם מחזור שנתי מעל 500,000 ₪. בדקו מול רואה החשבון.",
  },
  income_tax_advance: {
    id: "income_tax_advance",
    authority: "tax",
    title: "מקדמות מס הכנסה",
    short: "מקדמות מס",
    cadenceText: "כל חודש או כל חודשיים, לפי פנקס המקדמות",
    what: "המחזור של התקופה לפני מע״מ, אחוז המקדמה מהפנקס, והסכום לתשלום אחרי קיזוז ניכוי במקור.",
    when: "ב-15 בחודש שאחרי התקופה, ובדיווח ותשלום באתר עד ה-19 בשעה 18:30. באותם מועדים שקבעה רשות המסים לדוחות המע״מ.",
    how: "בשירות התשלום המקוון של רשות המסים: מספר תיק, התקופה, המחזור והתשלום.",
    whereLabel: "דיווח ותשלום מקדמות מס הכנסה",
    whereUrl: "https://www.gov.il/he/service/itc-payment-online-incometax",
    appHref: "/reports/advances",
    appLabel: "פתח את חישוב המקדמות",
  },
  withholding: {
    id: "withholding",
    authority: "tax",
    title: "דיווח ניכויים (טופס 102)",
    short: "ניכויים",
    cadenceText: "כל חודש",
    what: "המשכורות ששולמו לעובדים והמס שנוכה מהן.",
    when: "ב-16 בחודש שאחרי, לפי המועדים שרשות המסים קבעה.",
    how: "בשירות הדיווח המקוון לניכויים של רשות המסים, בדרך כלל דרך תוכנת השכר או רואה החשבון.",
    whereLabel: "לוח מועדי הדיווח של רשות המסים",
    whereUrl: OFFICIAL_CALENDAR_URL,
    appliesNote: "רק אם יש לך עובדים.",
  },
  exempt_declaration: {
    id: "exempt_declaration",
    authority: "vat",
    title: "הצהרת עוסק פטור שנתית",
    short: "הצהרת פטור",
    cadenceText: "פעם בשנה",
    what: "מספר אחד: מחזור העסקאות של השנה שהסתיימה.",
    when: "עד 31 בינואר, על השנה הקודמת. מועד שחל בשבת או בחג עובר ליום העסקים הבא.",
    how: "נכנסים לשירות הצהרת עוסק פטור עם שם המשתמש של האזור האישי ברשות המסים ומקלידים את המחזור.",
    whereLabel: "הצהרת עוסק פטור",
    whereUrl: "https://www.gov.il/he/service/vat-declarationisexempt",
    appHref: "/reports/vat",
    appLabel: "פתח את ההצהרה המוכנה",
  },
  annual_report: {
    id: "annual_report",
    authority: "tax",
    title: "דוח שנתי למס הכנסה (1301)",
    short: "דוח שנתי",
    cadenceText: "פעם בשנה",
    what: "כל ההכנסות וההוצאות של השנה, עם דוח רווח והפסד, זיכויים וניכויים.",
    when: "לפי החוק עד 30 באפריל שאחרי שנת המס. רשות המסים מפרסמת כמעט כל שנה דחייה: את הדוח לשנת 2025 היה אפשר להגיש באופן מקוון עד 30.6.2026.",
    how: "מילוי הדוח המקוון באזור האישי, או הגשה דרך רואה חשבון.",
    whereLabel: "הגשת דוח שנתי מקוון",
    whereUrl: "https://www.gov.il/he/service/reporting-and-payment-2025-annual-tax-report-for-individuals",
    appHref: "/reports/form-1301",
    appLabel: "פתח את העזר לטופס 1301",
  },
  btl_advance: {
    id: "btl_advance",
    authority: "btl",
    title: "מקדמות ביטוח לאומי",
    short: "ביטוח לאומי",
    cadenceText: "כל חודש",
    what: "המקדמה החודשית לביטוח לאומי ולביטוח בריאות, לפי ההכנסה שדיווחת.",
    when: "עד 15 בחודש על החודש הקודם. בהוראת קבע החיוב יורד ב-22 בחודש.",
    how: "הוראת קבע או תשלום באתר ביטוח לאומי. כשההכנסה משתנה, מעדכנים את המקדמות באזור האישי.",
    whereLabel: "תשלומים ושירותים לעצמאים בביטוח לאומי",
    whereUrl: "https://b2b.btl.gov.il/BTL.ILG.Payments/HomePage.aspx",
  },
  pension_deposit: {
    id: "pension_deposit",
    authority: "tax",
    title: "הפקדה לפנסיה חובה לעצמאים",
    short: "פנסיה חובה",
    cadenceText: "פעם בשנה",
    what: "הפקדה לקופת פנסיה לפי ההכנסה של השנה.",
    when: "עד 31 בדצמבר של אותה שנה.",
    how: "הפקדה ישירה לקרן הפנסיה או דרך סוכן הביטוח.",
    whereLabel: "פנסיה חובה לעצמאים (כל זכות)",
    whereUrl: "https://www.kolzchut.org.il/he/%D7%A4%D7%A0%D7%A1%D7%99%D7%94_%D7%97%D7%95%D7%91%D7%94_%D7%9C%D7%A2%D7%A6%D7%9E%D7%90%D7%99%D7%9D",
    appliesNote: "לעצמאים בני 21 עד 60 שנולדו אחרי 1961 ופועלים לפחות חצי שנה.",
  },
};

export interface ObligationOccurrence {
  /** Stable key for "filed" marks and reminders: obligation + reporting period. */
  key: string;
  id: ObligationId;
  authority: Authority;
  /** Deadline, ISO. */
  date: string;
  /** Online filing-and-payment deadline, when later than `date`. */
  onlineDate?: string;
  official: boolean;
  /** "יולי-אוגוסט 2026" / "אוגוסט 2026" / "שנת 2026". */
  periodLabel: string;
}

const MONTHS_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

function periodLabelFor(y: number, lastMonth: number, cadence: Cadence): string {
  if (cadence === "monthly") return `${MONTHS_HE[lastMonth - 1]} ${y}`;
  return `${MONTHS_HE[lastMonth - 2]}-${MONTHS_HE[lastMonth - 1]} ${y}`;
}

export function filesVat(type: Business["businessType"]): boolean {
  return type === "authorized" || type === "company";
}

/**
 * Which obligations apply to this business, in display order. A company files
 * VAT, advances and deductions like a dealer, but not the self-employed
 * individual's national insurance advances, form 1301 or mandatory pension;
 * its annual filings (1214 and financial statements) go through the
 * accountant, and the page says so instead of listing them.
 */
export function applicableObligations(type: Business["businessType"], prefs: FilingPreferences): ObligationId[] {
  const ids: ObligationId[] = [];
  if (filesVat(type)) {
    ids.push("vat_periodic");
    if (prefs.detailedReporter) ids.push("vat_detailed");
  } else {
    ids.push("exempt_declaration");
  }
  ids.push("income_tax_advance");
  if (prefs.hasEmployees) ids.push("withholding");
  if (type !== "company") ids.push("btl_advance", "annual_report", "pension_deposit");
  return ids;
}

/**
 * Every deadline of the applicable obligations whose date falls inside
 * [from, to] (inclusive ISO dates), sorted by date. Reporting periods are
 * generated from a year before `from` so a deadline in January for December
 * still appears.
 */
export function obligationOccurrences(
  type: Business["businessType"],
  prefs: FilingPreferences,
  from: string,
  to: string,
): ObligationOccurrence[] {
  const ids = new Set(applicableObligations(type, prefs));
  const out: ObligationOccurrence[] = [];
  const push = (o: ObligationOccurrence) => {
    if (o.date >= from && o.date <= to) out.push(o);
  };
  const startYear = Number(from.slice(0, 4)) - 1;
  const endYear = Number(to.slice(0, 4));

  for (let y = startYear; y <= endYear; y++) {
    for (let m = 1; m <= 12; m++) {
      const ym = `${y}-${pad2(m)}`;
      const periodic = (id: ObligationId, kind: keyof OfficialMonth, cadence: Cadence) => {
        if (!ids.has(id)) return;
        if (cadence === "bimonthly" && m % 2 !== 0) return;
        const d = periodicDeadline(kind, ym);
        const tag = cadence === "bimonthly" ? `${y}-B${m / 2}` : ym;
        push({ key: `${id}:${tag}`, id, authority: OBLIGATIONS[id].authority, date: d.date, onlineDate: d.onlineDate, official: d.official, periodLabel: periodLabelFor(y, m, cadence) });
      };
      periodic("vat_periodic", "periodic", prefs.vatCadence);
      periodic("vat_detailed", "detailed", prefs.vatCadence);
      periodic("income_tax_advance", "periodic", prefs.advanceCadence);
      periodic("withholding", "withholding", "monthly");
      if (ids.has("btl_advance")) {
        const [ny, nm] = nextMonth(ym);
        push({ key: `btl_advance:${ym}`, id: "btl_advance", authority: "btl", date: iso(ny, nm, 15), official: false, periodLabel: `${MONTHS_HE[m - 1]} ${y}` });
      }
    }
    if (ids.has("exempt_declaration")) {
      push({ key: `exempt_declaration:${y}`, id: "exempt_declaration", authority: "vat", date: iso(y + 1, 1, 31), official: false, periodLabel: `שנת ${y}` });
    }
    if (ids.has("annual_report")) {
      push({ key: `annual_report:${y}`, id: "annual_report", authority: "tax", date: iso(y + 1, 4, 30), official: false, periodLabel: `שנת המס ${y}` });
    }
    if (ids.has("pension_deposit")) {
      push({ key: `pension_deposit:${y}`, id: "pension_deposit", authority: "tax", date: iso(y, 12, 31), official: false, periodLabel: `שנת ${y}` });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key.localeCompare(b.key)));
}

/** Whole days from `today` to `date` (both ISO), negative when past. */
export function daysUntil(date: string, today: string): number {
  const [y1, m1, d1] = today.split("-").map(Number);
  const [y2, m2, d2] = date.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** "היום" / "מחר" / "בעוד 4 ימים" / "לפני 3 ימים". */
export function relativeDayLabel(date: string, today: string): string {
  const n = daysUntil(date, today);
  if (n === 0) return "היום";
  if (n === 1) return "מחר";
  if (n === -1) return "אתמול";
  if (n > 1) return `בעוד ${n} ימים`;
  return `לפני ${-n} ימים`;
}
