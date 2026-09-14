// Stable identifiers for every מבנה אחיד (OPENFORMAT 1.31) finding. Pure on
// purpose: the reports page imports the titles, the export route and the
// nightly guard import the codes, and none of them may pull iconv-lite in.
// Codes are never renamed once shipped: guard state and support messages
// carry them.

export type UniformIssueCode =
  // input: business and period
  | "dealer_number_invalid"
  | "business_name_missing"
  | "period_invalid"
  | "text_truncated"
  // input: clients, documents, expenses
  | "client_number_not_israeli"
  | "customer_number_not_israeli"
  | "customer_number_from_client"
  | "client_missing"
  | "date_invalid"
  | "document_number_invalid"
  | "duplicate_document_number"
  | "foreign_currency_missing_ils"
  | "foreign_currency_invalid"
  | "foreign_currency_ils_mismatch"
  | "ils_mismatch"
  | "amount_invalid"
  | "total_mismatch"
  | "too_many_lines"
  | "items_mismatch"
  | "item_amount_invalid"
  | "check_details_invalid"
  | "check_due_date_invalid"
  | "expense_amount_invalid"
  // the built file
  | "file_dealer_invalid"
  | "file_envelope_mismatch"
  | "envelope_duplicate"
  | "ini_header_mismatch"
  | "ini_summary_mismatch"
  | "record_count_mismatch"
  | "record_invalid"
  | "record_date_invalid"
  | "record_amount_invalid"
  | "document_link_invalid"
  | "detail_link_invalid"
  | "detail_item_missing"
  | "journal_missing_account"
  | "journal_side_invalid"
  | "journal_unbalanced"
  | "account_key_duplicate"
  | "doc_summary_mismatch"
  | "sample_too_small"
  // the export route
  | "software_registration_missing"
  | "data_load_failed"
  | "rate_limited";

export type UniformIssueSource = "business" | "client" | "document" | "expense";

export interface UniformIssue {
  /** Stable identifier: wording may change, codes may not. */
  code: UniformIssueCode;
  /** "error" blocks the download; "warning" is a note. */
  level: "error" | "warning";
  message: string;
  source?: UniformIssueSource;
  sourceId?: string;
  sourceLabel?: string;
  /** The stored value an inline fix starts from (business number, a document's customer number, an expense date). */
  current?: string;
  /** The document came from a data import. */
  imported?: boolean;
}

export const UNIFORM_FIX_TITLES: Record<UniformIssueCode, string> = {
  dealer_number_invalid: "מספר העוסק של העסק בהגדרות לא תקין",
  business_name_missing: "חסר שם העסק בהגדרות",
  period_invalid: "שנת המס או תאריכי הדוח לא תקינים",
  text_truncated: "טקסט ארוך או תווים שלא נתמכים בקובץ",
  client_number_not_israeli: "מספר הזיהוי של הלקוח אינו מספר עוסק ישראלי",
  customer_number_not_israeli: "מספר הלקוח במסמך אינו מספר עוסק ישראלי",
  customer_number_from_client: "מספר הלקוח במסמך נלקח מכרטיס הלקוח",
  client_missing: "הלקוח המקושר למסמך חסר",
  date_invalid: "תאריך חסר או לא תקין",
  document_number_invalid: "סוג או מספר המסמך לא תקינים",
  duplicate_document_number: "מספר מסמך כפול",
  foreign_currency_missing_ils: "חסרים סכומים בשקלים למסמך במטבע חוץ",
  foreign_currency_invalid: "חסר שער המרה או קוד מטבע למסמך במטבע חוץ",
  foreign_currency_ils_mismatch: "סכומי השקל של מסמך במטבע חוץ לא תואמים לשער",
  ils_mismatch: "סכומי השקל השמורים לא תואמים למסמך",
  amount_invalid: "סכום חסר או גדול מדי לשדות הקובץ",
  total_mismatch: "הסכום הכולל לא תואם לסכום לפני מע״מ, המע״מ והעיגול",
  too_many_lines: "יותר מדי שורות במסמך",
  items_mismatch: "סכום השורות לא תואם לסכום המסמך",
  item_amount_invalid: "כמות או סכום לא תקינים בשורת מסמך",
  check_details_invalid: "חסרים פרטי המחאה",
  check_due_date_invalid: "תאריך פירעון ההמחאה לא תקין",
  expense_amount_invalid: "סכום ההוצאה חסר או גדול מדי",
  file_dealer_invalid: "מספר העוסק בקובץ שנבנה לא תקין",
  file_envelope_mismatch: "רשומות הפתיחה והסיום לא תואמות",
  envelope_duplicate: "רשומת פתיחה או סיום כפולה",
  ini_header_mismatch: "כותרת קובץ INI לא תואמת לקובץ הנתונים",
  ini_summary_mismatch: "סיכומי קובץ INI לא תואמים לקובץ הנתונים",
  record_count_mismatch: "ספירת הרשומות לא תואמת",
  record_invalid: "רשומה במבנה לא תקין",
  record_date_invalid: "תאריך לא תקין ברשומה",
  record_amount_invalid: "סכום או סימן לא תקינים ברשומה",
  document_link_invalid: "קישור כותרת מסמך חסר או כפול",
  detail_link_invalid: "שורת פירוט שלא מקושרת לכותרת המסמך",
  detail_item_missing: "שורת פירוט שמפנה לפריט חסר",
  journal_missing_account: "תנועת יומן שמפנה לחשבון חסר",
  journal_side_invalid: "צד חובה או זכות לא תקין",
  journal_unbalanced: "פקודת יומן לא מאוזנת",
  account_key_duplicate: "מפתח חשבון כפול בקובץ",
  doc_summary_mismatch: "סיכום המסמכים לא תואם לכותרות המסמכים",
  sample_too_small: "קובץ הדוגמה קטן מדי לסימולטור",
  software_registration_missing: "מספר רישום התוכנה עוד לא הוזן",
  data_load_failed: "טעינת נתוני הדוח נכשלה",
  rate_limited: "יותר מדי בדיקות ברצף",
};

/** The one download gate: nothing at level "error". */
export function uniformCanDownload(issues: readonly Pick<UniformIssue, "level">[]): boolean {
  return !issues.some((issue) => issue.level === "error");
}

/** Distinct codes of everything that blocks the download. The nightly guard counts these. */
export function uniformBlockingCodes(issues: readonly Pick<UniformIssue, "level" | "code">[]): UniformIssueCode[] {
  return [...new Set(issues.filter((issue) => issue.level === "error").map((issue) => issue.code))];
}
