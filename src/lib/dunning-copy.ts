import { formatDocTotal } from "@/lib/currencies";
import { formatDate } from "@/lib/format";

// One source of truth for the collection-reminder wording, shared by the two
// channels that use it:
//
//  * the daily dunning email (src/app/api/dunning/run/route.ts), which sends
//    to the client from the app's mail server;
//  * the assisted WhatsApp reminder, which only PREPARES a message that the
//    owner then sends from their own number with one tap.
//
// The strings below were the email's for months. The document noun is a
// placeholder since 2026-09-15 so a חשבון עסקה is not called "חשבונית המס";
// for a tax invoice the rendered text is still byte-for-byte what it always
// was. Anything that edits them changes both channels on purpose.
//
// House rule: plain hyphens only, never a long dash.

export type DunningStage = 3 | 14 | 30;
export const DUNNING_STAGES: DunningStage[] = [30, 14, 3]; // newest first; earliest match wins

export const DUNNING_SUBJECTS: Record<DunningStage, string> = {
  3: "תזכורת: {doc} מספר {n}",
  14: "תזכורת שנייה: {doc} מספר {n}",
  30: "{doc} מספר {n}: תשלום מתעכב",
};

export const DUNNING_TONES: Record<DunningStage, { intro: string; cta: string; signoff: string }> = {
  3: {
    intro: "מקווה שהמסמך הגיע בסדר. רק רציתי לוודא שראיתם את {docFull} מספר {n} על סך {total} ששלחנו ב-{date}.",
    cta: "אם נוח לכם, אשמח לסגור את התשלום. כל פרטי התשלום נמצאים {inDoc}.",
    signoff: "תודה רבה,",
  },
  14: {
    intro: "אנחנו עוקבים אחרי {doc} מספר {n} על סך {total} ששלחנו ב-{date}. חלפו כבר {days} ימים ולא ראינו את התשלום.",
    cta: "אשמח לקבל עדכון: האם התשלום בוצע ולא הגיע, או שעדיין מתעכב?",
    signoff: "תודה,",
  },
  30: {
    intro: "{doc} מספר {n} על סך {total} מ-{date} עדיין לא {paid}. חלפו {days} ימים.",
    cta: "אנא תאמו אתנו תאריך תשלום בהקדם. אם יש בעיה או שאלה, נשמח לסייע.",
    signoff: "בכבוד רב,",
  },
};

/**
 * The document-noun placeholders for a reminder, in correct Hebrew for the
 * type. Only the two receivable types are ever chased (see
 * isOpenReceivable); anything else falls back to the tax-invoice wording.
 * "חשבון עסקה" is masculine, so its verb is "שולם", not "שולמה".
 */
export function dunningDocVars(type?: string | null): Record<"doc" | "docFull" | "theDoc" | "inDoc" | "paid", string> {
  if (type === "proforma") {
    return {
      doc: "חשבון עסקה",
      docFull: "חשבון העסקה",
      theDoc: "חשבון העסקה",
      inDoc: "בחשבון העסקה",
      paid: "שולם",
    };
  }
  return {
    doc: "חשבונית",
    docFull: "חשבונית המס",
    theDoc: "החשבונית",
    inDoc: "בחשבונית",
    paid: "שולמה",
  };
}

/** Fill `{n}` / `{total}` / `{date}` / `{days}` / document-noun placeholders. Unknown keys
 *  render as empty rather than leaving a raw `{brace}` in a client's face. */
export function fillDunningVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

/**
 * Whole calendar days between the issue date ("YYYY-MM-DD") and today.
 * Calendar day to calendar day: `dateStr` parses as UTC midnight, so mixing
 * it with a local clock drifts by a day near midnight and can fire a stage
 * early or late.
 */
export function daysSinceIssue(dateStr: string, now: Date = new Date()): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const issuedUTC = Date.UTC(y, m - 1, d);
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((todayUTC - issuedUTC) / 86400000);
}

/** Which of the 3 / 14 / 30 stages a document at `days` overdue is in.
 *  Highest reached stage wins; `null` before day 3. */
export function dunningStageFor(days: number): DunningStage | null {
  for (const stage of DUNNING_STAGES) {
    if (days >= stage) return stage;
  }
  return null;
}

/**
 * The neutral wording for a document that has not reached day 3 yet. The
 * owner can still tap "תזכורת בוואטסאפ" on day 1, and dropping the day-3
 * tone on them there would sound like chasing someone who is not late.
 */
export const PRE_STAGE_TONE = {
  intro: "שלחתי לך את {theDoc} מספר {n} על סך {total} מ-{date}, אשמח לתשלום.",
  cta: "כל פרטי התשלום נמצאים במסמך. אם כבר שילמת, אפשר להתעלם מההודעה.",
  signoff: "תודה,",
};

export function toneForStage(stage: DunningStage | null) {
  return stage == null ? PRE_STAGE_TONE : DUNNING_TONES[stage];
}

interface ReminderTextArgs {
  /** Signature at the bottom: the business the client knows. */
  businessName: string;
  clientName: string;
  number: number;
  total: number;
  /** ISO 4217 code the total is in; missing means ILS. */
  currency?: string | null;
  /** Document type, for the noun ("חשבונית" / "חשבון עסקה"). */
  docType?: string | null;
  /** Issue date, already formatted for a human reader. */
  date: string;
  days: number;
  /** `null` before day 3 - see PRE_STAGE_TONE. */
  stage: DunningStage | null;
  /** Public /view/<id> link on the canonical origin. */
  viewUrl: string;
}

/**
 * The message body the owner's WhatsApp opens with. Same intro/cta as the
 * email of that stage, laid out for a chat window and ending with the view
 * link so the client can open the document without digging through mail.
 */
export function whatsappReminderText(args: ReminderTextArgs): string {
  const tone = toneForStage(args.stage);
  const vars = {
    ...dunningDocVars(args.docType),
    n: String(args.number),
    total: formatDocTotal(args.total, args.currency),
    date: args.date,
    days: String(args.days),
  };
  return (
    `שלום ${args.clientName},\n\n` +
    `${fillDunningVars(tone.intro, vars)}\n\n` +
    `${fillDunningVars(tone.cta, vars)}\n\n` +
    `לצפייה במסמך: ${args.viewUrl}\n\n` +
    `${tone.signoff}\n${args.businessName}`
  );
}

export interface DunningEmailContent {
  subject: string;
  intro: string;
  cta: string;
  signoff: string;
}

/**
 * Everything wording-related in one stage's dunning email, already filled:
 * the noun matches the type, the total is in the document's own currency and
 * the issue date is the Israeli DD.MM.YYYY, never the raw ISO value.
 *
 * The copy is Hebrew only. An English document still gets the Hebrew email
 * (there is no English collection wording yet), but its amount is correct.
 */
export function dunningEmailContent(args: {
  stage: DunningStage;
  docType?: string | null;
  number: number;
  total: number;
  currency?: string | null;
  /** Issue date as stored, "YYYY-MM-DD". */
  date: string;
  days: number;
}): DunningEmailContent {
  const tone = DUNNING_TONES[args.stage];
  const vars = {
    ...dunningDocVars(args.docType),
    n: String(args.number),
    total: formatDocTotal(args.total, args.currency),
    date: formatDate(args.date),
    days: String(args.days),
  };
  return {
    subject: fillDunningVars(DUNNING_SUBJECTS[args.stage], vars),
    intro: fillDunningVars(tone.intro, vars),
    cta: fillDunningVars(tone.cta, vars),
    signoff: tone.signoff,
  };
}
