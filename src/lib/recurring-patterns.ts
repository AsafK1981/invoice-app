import { clampDayToMonth } from "./reminder-schedule";
import { normalizeName } from "./client-picker";
import { HEBREW_MONTHS, documentSignature, rollTextForward } from "./recurring-prefill";
import type { DocumentType } from "./types";

/**
 * "You bill this client the same thing every month" - detected, not asked.
 *
 * `recurring-prefill.ts` answers a question the user already asked ("I am
 * creating a document for this client, what usually goes on it?"), so two
 * past documents are enough there. This module answers a question nobody
 * asked: it is what lets the app push a prepared invoice at the owner on the
 * day they usually issue it. Pushing unasked has to clear a much higher bar,
 * hence >= 3 occurrences in >= 3 distinct months with roughly monthly gaps.
 *
 * Pure: no fetching, no clock, no React. The cron passes in the documents and
 * today's Israel-local date; every date here is plain YYYY-MM-DD string math
 * (see date.ts for why Date#setMonth is never used for Israel calendar work).
 */

/** How many occurrences before a cadence is real enough to push at the owner. */
const MIN_OCCURRENCES = 3;
/** Days after the pattern's day-of-month the proposal window stays open. */
const DEFAULT_TOLERANCE = 3;
/** How far back to look for the cadence. */
const DEFAULT_LOOKBACK_MONTHS = 12;
/** Consecutive gap (days) that still counts as "about a month apart". */
const MIN_GAP_DAYS = 20;
const MAX_GAP_DAYS = 40;
/** Months the newest occurrence may be behind the target month before the
 *  cadence counts as over rather than ongoing. */
const MAX_STALE_MONTHS = 1;
/** How far back a dismissal still counts towards the auto-mute. Older ones
 *  decay: someone who said "לא עכשיו" twice last winter has not opted out of
 *  this summer's cadence. */
const MUTE_DECAY_MONTHS = 4;

/**
 * Document types a cadence may propose.
 *
 * A quote is an offer, not a bill - proposing one every month would push the
 * owner to re-quote work that is already agreed. A credit note is a correction
 * and is stored NEGATIVE app-wide, which the proposal money path (always
 * positive) cannot express.
 */
const PROPOSABLE_TYPES: DocumentType[] = [
  "receipt",
  "proforma",
  "tax_invoice",
  "tax_invoice_receipt",
];

/** A past document, in the shape the detector needs (see the cron route). */
export interface RecurringSourceDoc {
  id: string;
  number: number;
  type: DocumentType;
  status: string;
  /** Document date, YYYY-MM-DD. */
  date: string;
  clientId: string | null;
  clientName: string;
  subject: string;
  notes?: string | null;
  /** Document currency; anything but ILS is skipped (see below). */
  currency?: string | null;
  /** Zero-rated (עסקה בשיעור אפס). Skipped: the approve path issues at the
   *  business's normal VAT rate. */
  zeroRated?: boolean | null;
  /** A discount or a withholding on the source document means the money on it
   *  is not the money the proposed lines would issue. Both skip the document. */
  discountAmount?: number | null;
  withholdingAmount?: number | null;
  items: { description: string; quantity: number; unitPrice: number }[];
}

export interface RecurringPatternItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface RecurringPattern {
  /** Proposal `source`, stable across months: "pattern:<hash>". */
  source: string;
  documentType: DocumentType;
  clientId: string | null;
  clientName: string;
  /** clientId, or the normalised client name when the documents carry none. */
  clientKey: string;
  /** documentSignature of the group (subject + item descriptions, periods stripped). */
  signature: string;
  /** Median issue day-of-month, 1-31, NOT clamped to the target month. */
  dayOfMonth: number;
  /** How many past documents formed the cadence. */
  occurrences: number;
  tolerance: number;
  /** Target billing period, YYYY-MM (the month of `today`). */
  period: string;
  /** `dayOfMonth` clamped into the target month. */
  targetDay: number;
  /** YYYY-MM-DD of `targetDay` in the target month. */
  targetDate: string;
  /** Proposal window, inclusive: [targetDay - 1, targetDay + tolerance]. */
  windowStart: string;
  windowEnd: string;
  /** Is `today` inside the window? */
  due: boolean;
  /** Template subject, rolled forward to `targetDate`. */
  subject: string;
  /** Template notes from the newest document, rolled forward like the subject
   *  (they print on the same document, so they cannot name a different month). */
  notes: string;
  /** Template lines, descriptions rolled forward to `targetDate`. */
  items: RecurringPatternItem[];
  lastDocId: string;
  lastDocNumber: number;
  lastDocDate: string;
}

export interface DetectRecurringOptions {
  /** Israel-local today, YYYY-MM-DD. Anchors the target period and the roll-forward. */
  today: string;
  /** Days after the pattern day the window stays open. Default 3. */
  tolerance?: number;
  /** Ignore documents older than this many months. Default 12. */
  lookbackMonths?: number;
  /** Occurrences needed. Default 3. Lower values are for tests only. */
  minOccurrences?: number;
}

/** Whole days from `a` to `b` (both YYYY-MM-DD), sign included. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  if (!ay || !am || !ad || !by || !bm || !bd) return 0;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** `YYYY-MM`, `months` months before `period`. */
export function periodMinusMonths(period: string, months: number): string {
  const total = Number(period.slice(0, 4)) * 12 + (Number(period.slice(5, 7)) - 1) - months;
  const y = Math.floor(total / 12);
  const m = (((total % 12) + 12) % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** YYYY-MM-DD: the 1st of the month `monthsBack` months before `iso`'s month.
 *  Exported so the cron route shares this arithmetic instead of copying it. */
export function monthsBackStart(iso: string, monthsBack: number): string {
  return `${periodMinusMonths(iso.slice(0, 7), monthsBack)}-01`;
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * FNV-1a 32-bit, hex. Not a security primitive - it only has to be stable
 * across runs and deployments, because the proposal `source` derived from it
 * is the dedupe key that keeps one card per pattern per month. Short on
 * purpose: the API caps `source` at 60 characters.
 */
function hash32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The proposal `source` for a pattern. Exported so the tests can assert stability. */
export function patternSource(documentType: string, clientKey: string, signature: string): string {
  return `pattern:${hash32(`${documentType}|${clientKey}|${signature}`)}`;
}

/** clientId when the documents carry one, else the normalised name. */
export function patternClientKey(clientId: string | null | undefined, clientName: string): string {
  return clientId || normalizeName(clientName);
}

/** The lower median of a numeric list - deterministic, no averaging of days. */
function medianDay(days: number[]): number {
  const sorted = [...days].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * A document that can take part in a cadence at all.
 *
 * Drafts have no committed number and may never be issued; cancelled ones were
 * undone; only PROPOSABLE_TYPES can be billed on a schedule.
 *
 * The rest of the rules all say the same thing: the approve path issues a
 * plain ILS document at the business's normal VAT rate, with no discount and
 * no withholding. A document that carried any of those bills a different
 * amount than the proposal built from it would, and the owner would approve
 * the difference without being shown it.
 */
function usable(doc: RecurringSourceDoc): boolean {
  if (doc.status === "draft" || doc.status === "cancelled") return false;
  if (!PROPOSABLE_TYPES.includes(doc.type)) return false;
  const currency = (doc.currency || "ILS").toUpperCase();
  if (currency !== "ILS") return false;
  if (doc.zeroRated === true) return false;
  if ((doc.discountAmount || 0) > 0) return false;
  if ((doc.withholdingAmount || 0) > 0) return false;
  if (!doc.date || doc.date.length < 10) return false;
  return (doc.items || []).length > 0;
}

// "מרס" is the alternate spelling of מרץ that recurring-prefill accepts.
const MONTH_NAME_ALIASES: Record<number, string[]> = { 3: ["מרס"] };

/**
 * Does `text` explicitly name `period` (YYYY-MM)? Either the Hebrew month name
 * (with the usual one or two letter prefix - ב, ל, ה) or a numeric MM/YYYY,
 * MM.YY, MM-YY. A full date (01/09/2026) does not count, the same way
 * recurring-prefill leaves full dates alone.
 *
 * The JS word-boundary assertion is dead next to Hebrew letters (see
 * spoken.ts), so the boundary is spelled out here: an optional Hebrew prefix
 * run before the name, and no Hebrew letter after it.
 */
export function textNamesPeriod(text: string | null | undefined, period: string): boolean {
  if (!text) return false;
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  if (!year || !month || month < 1 || month > 12) return false;

  for (const name of [HEBREW_MONTHS[month - 1], ...(MONTH_NAME_ALIASES[month] || [])]) {
    // The u05d0-u05ea escapes are resolved by the template literal into the
    // two literal Hebrew letters before the regex ever sees them, which is
    // exactly what a character class wants. Regex-level escapes must NOT be
    // written this way here (see the numeric line below).
    const re = new RegExp(`(?:^|[^\u05d0-\u05ea])[\u05d0-\u05ea]{0,2}${name}(?![\u05d0-\u05ea])`);
    if (re.test(text)) return true;
  }

  const yy = String(year % 100).padStart(2, "0");
  // [0-9] for the same reason: `\d` inside a template literal collapses to "d".
  return new RegExp(`(?:^|[^0-9/.-])0?${month}[/.-](?:${year}|${yy})(?![0-9])`).test(text);
}

/**
 * Detect the business's recurring documents and prepare each one for the
 * target month (the month of `opts.today`).
 *
 * Grouping: document type + client (id, or normalised name for unlinked
 * documents - same rule as documentsForClient) + documentSignature.
 *
 * A group becomes a pattern when, after collapsing to one document per
 * calendar month (a second document in the same month is a top-up, not a
 * second occurrence), it has at least `minOccurrences` months and every
 * consecutive gap is 20-40 days. That gap band is what separates "the 1st of
 * every month" from "three documents that happened to land in three months".
 * The newest occurrence also has to be recent (this month or the previous
 * one), so a retainer that ended does not keep proposing itself forever.
 *
 * Every returned pattern carries its window and a `due` flag; the caller
 * decides what to do with the ones that are due today.
 */
export function detectRecurringPatterns(
  docs: RecurringSourceDoc[],
  opts: DetectRecurringOptions,
): RecurringPattern[] {
  const today = opts.today;
  if (!today || today.length < 10) return [];
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const minOccurrences = opts.minOccurrences ?? MIN_OCCURRENCES;
  const since = monthsBackStart(today, opts.lookbackMonths ?? DEFAULT_LOOKBACK_MONTHS);
  // The newest occurrence must be from this month or the one before it.
  const freshFrom = monthsBackStart(today, MAX_STALE_MONTHS);

  interface Group {
    documentType: DocumentType;
    clientKey: string;
    signature: string;
    docs: RecurringSourceDoc[];
  }
  const groups = new Map<string, Group>();
  for (const doc of docs) {
    if (!usable(doc) || doc.date < since) continue;
    const signature = documentSignature(doc);
    if (!signature) continue;
    const clientKey = patternClientKey(doc.clientId, doc.clientName);
    if (!clientKey) continue;
    const key = `${doc.type}|${clientKey}|${signature}`;
    const group = groups.get(key);
    if (group) group.docs.push(doc);
    else groups.set(key, { documentType: doc.type, clientKey, signature, docs: [doc] });
  }

  const targetYear = Number(today.slice(0, 4));
  const targetMonth = Number(today.slice(5, 7));
  const todayDay = Number(today.slice(8, 10));
  const period = today.slice(0, 7);

  const patterns: RecurringPattern[] = [];
  for (const { documentType, clientKey, signature, docs: group } of groups.values()) {
    if (group.length < minOccurrences) continue;

    // One occurrence per calendar month, the earliest in that month (the day
    // the owner actually bills; a later top-up should not move the cadence).
    const byMonth = new Map<string, RecurringSourceDoc>();
    for (const doc of group) {
      const month = doc.date.slice(0, 7);
      const kept = byMonth.get(month);
      if (!kept || doc.date < kept.date) byMonth.set(month, doc);
    }
    const points = [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (points.length < minOccurrences) continue;

    // A cadence that stopped is not a cadence. Without this, a retainer that
    // ended in June would still push a card every month forever: the three
    // occurrences and their gaps stay valid no matter how old they get.
    if (points[points.length - 1].date < freshFrom) continue;

    let monthly = true;
    for (let i = 1; i < points.length; i++) {
      const gap = daysBetween(points[i - 1].date, points[i].date);
      if (gap < MIN_GAP_DAYS || gap > MAX_GAP_DAYS) {
        monthly = false;
        break;
      }
    }
    if (!monthly) continue;

    const dayOfMonth = medianDay(points.map((p) => Number(p.date.slice(8, 10))));
    const targetDay = clampDayToMonth(targetYear, targetMonth, dayOfMonth);
    const targetDate = isoDate(targetYear, targetMonth, targetDay);
    // A window that opened on the last day of the previous month would belong
    // to the previous period, so day 1 patterns simply open on the 1st.
    const windowStartDay = Math.max(1, targetDay - 1);
    const windowEndDay = clampDayToMonth(targetYear, targetMonth, targetDay + tolerance);

    // The template is the newest COLLAPSED point, not the newest raw document
    // in the group: a same-month top-up (a second receipt on the 20th for an
    // extra hour, at a different price) must never become next month's
    // proposal. `points` already holds one document per month, the one the
    // cadence is actually built from.
    const template = points[points.length - 1];

    patterns.push({
      source: patternSource(documentType, clientKey, signature),
      documentType,
      clientId: template.clientId || null,
      clientName: template.clientName,
      clientKey,
      signature,
      dayOfMonth,
      occurrences: points.length,
      tolerance,
      period,
      targetDay,
      targetDate,
      windowStart: isoDate(targetYear, targetMonth, windowStartDay),
      windowEnd: isoDate(targetYear, targetMonth, windowEndDay),
      due: todayDay >= windowStartDay && todayDay <= windowEndDay,
      subject: rollTextForward(template.subject?.trim() || "", template.date, targetDate),
      notes: rollTextForward((template.notes || "").trim(), template.date, targetDate),
      items: (template.items || []).map((i) => ({
        description: rollTextForward(i.description || "", template.date, targetDate),
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
      lastDocId: template.id,
      lastDocNumber: template.number,
      lastDocDate: template.date,
    });
  }

  // Deterministic order, so a run's output (and its tests) never depend on
  // Map insertion order.
  return patterns.sort((a, b) => a.source.localeCompare(b.source));
}

/**
 * Did the owner already issue this pattern's document for `period`, by hand or
 * otherwise? Same type + client + signature inside the billed month is enough -
 * the amount may legitimately differ month to month.
 *
 * Plus the advance-billing case: a document dated in the PREVIOUS month whose
 * own text names the TARGET period ("שכר דירה ספטמבר" issued on 30.8) is this
 * month's bill, issued early. The ordinary previous occurrence names the
 * previous month, so it never triggers this - which is exactly the line
 * between "already billed" and "the cadence's last document".
 */
export function alreadyBilledForPeriod(
  docs: RecurringSourceDoc[],
  pattern: Pick<RecurringPattern, "documentType" | "clientKey" | "signature">,
  period: string,
): boolean {
  const previousPeriod = periodMinusMonths(period, 1);
  return docs.some((doc) => {
    if (!usable(doc)) return false;
    if (doc.type !== pattern.documentType) return false;
    if (patternClientKey(doc.clientId, doc.clientName) !== pattern.clientKey) return false;
    // The signature has the period tokens stripped, so it is the family of the
    // recurring document rather than one month's wording of it.
    if (documentSignature(doc) !== pattern.signature) return false;

    const docPeriod = doc.date.slice(0, 7);
    if (docPeriod === period) return true;
    if (docPeriod !== previousPeriod) return false;
    if (textNamesPeriod(doc.subject, period)) return true;
    return (doc.items || []).some((i) => textNamesPeriod(i.description, period));
  });
}

/** An open proposal from any producer, as the cross-producer check needs it. */
export interface OpenProposalRow {
  source: string;
  /** Billing period, YYYY-MM. */
  period: string;
  status: string;
  clientId: string | null;
  clientName: string;
  subject: string;
  /** The proposed lines; only the descriptions matter here. */
  items: { description?: string | null }[];
}

/**
 * Is one of these open proposals already this pattern's bill?
 *
 * Two producers looking at the same history can queue the same invoice twice,
 * and because they use different `source` values the UNIQUE (business, source,
 * period) constraint never fires. The owner would see two cards for one
 * invoice and could approve both, minting two numbered documents for the same
 * work.
 *
 * The period is deliberately NOT the key. The finish-gigs automation bills in
 * ARREARS - its card created on 1.9 carries period 2026-08, the month whose
 * gigs it is billing - while this detector's period is the ISSUE month,
 * 2026-09. Same obligation, two different period strings. So the window is
 * "this period or the one before it" and the identity is client + signature.
 *
 * The signature is what keeps the check honest in the other direction: two
 * genuinely different cadences of the same type to the same client (two flats,
 * two rent receipts) have different signatures and do not block each other,
 * while the gigs card, whose subject normalizes to the same month-stripped
 * text, does.
 */
export function findConflictingProposal(
  rows: OpenProposalRow[],
  pattern: Pick<RecurringPattern, "source" | "clientId" | "clientName" | "clientKey" | "signature">,
  currentPeriod: string,
): OpenProposalRow | null {
  const oldestCounted = periodMinusMonths(currentPeriod, 1);
  const wantedName = normalizeName(pattern.clientName);

  return (
    rows.find((row) => {
      // The pattern's own rows are handled by the (source, period) checks;
      // this is only about OTHER producers.
      if (row.source === pattern.source) return false;
      // Pending blocks because it is an unanswered card for this bill.
      // Approved blocks as a belt: the document it became normally trips
      // alreadyBilledForPeriod first, but not if it was issued with a subject
      // the detector cannot recognise. Dismissed never blocks - the owner said
      // no to that producer's card, which is not consent to silence forever.
      if (row.status !== "pending" && row.status !== "approved") return false;
      if (row.period < oldestCounted || row.period > currentPeriod) return false;

      const clientMatches = pattern.clientId
        ? row.clientId === pattern.clientId
        : normalizeName(row.clientName || "") === wantedName;
      if (!clientMatches) return false;

      return documentSignature({ subject: row.subject, items: row.items }) === pattern.signature;
    }) || null
  );
}

/** A past proposal row for one pattern source, as the mute check needs it. */
export interface PatternProposalRow {
  period: string;
  status: string;
  details?: unknown;
}

function hasMuteFlag(details: unknown): boolean {
  if (!details || typeof details !== "object" || Array.isArray(details)) return false;
  return (details as Record<string, unknown>).mute === true;
}

/**
 * Should this pattern stop proposing?
 *
 * Two ways to say no:
 *   * "לא לזהות יותר את זה" on the card writes `details.mute = true` on the
 *     dismissed row. Permanent, one click, no decay.
 *   * The two most recent offers, both recent and both dismissed. Not
 *     calendar-consecutive: a pattern that was offered in May and July and
 *     dismissed both times counts, because those were the last two things the
 *     owner said about it. "Recent" means within MUTE_DECAY_MONTHS of the
 *     current period - two dismissals last winter must not silence this
 *     summer's cadence forever, since nothing but a new offer could ever undo
 *     them.
 *
 * The current period's own row is excluded from the count: it is checked
 * separately (any row for this period at all means "already answered or
 * already offered"), and counting it here would make a single dismissal look
 * like two.
 */
export function isPatternMuted(rows: PatternProposalRow[], currentPeriod: string): boolean {
  if (rows.some((r) => r.status === "dismissed" && hasMuteFlag(r.details))) return true;
  const oldestCounted = periodMinusMonths(currentPeriod, MUTE_DECAY_MONTHS);
  const recent = rows
    .filter((r) => r.period !== currentPeriod && r.period >= oldestCounted)
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, 2);
  return recent.length === 2 && recent.every((r) => r.status === "dismissed");
}
