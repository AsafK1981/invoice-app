// Spoken-Hebrew helpers for the WhatsApp bot.
//
// A voice note is transcribed and then handled by the SAME code as a typed
// message, but people do not speak the way they type. A typed correction is
// "סכום 150"; the spoken one is "אה, הסכום זה מאה וחמישים." - filler in front,
// a full sentence, punctuation at the end, numbers as words. Every gate in the
// handlers that used to assume typed input (the fresh-request regex, "בטל",
// the answer to "עבור מה?") goes through these helpers so a voice note can
// clear it too. Pure functions, no I/O, so they are cheap to test.

/**
 * Leading conversational filler a transcript often starts with. Stripped so
 * the words that carry the request come first. "לא" is NOT a filler: at the
 * start of a correction it carries meaning ("לא, זה בביט").
 */
const LEADING_FILLER =
  /^(?:(?:היי|הי|שלום|אהלן|אה+|אמ+|אממ+|אוקיי?|אוקי|טוב|אז|רגע|תקשיבי?|בבקשה|נו|יאללה|בוא|בואי|כן)[,.!?\s]+)+/;

/** Trailing sentence punctuation Whisper adds; a typed answer never has it. */
const TRAILING_PUNCT = /[.!?،,\s]+$/;

/**
 * Trims a transcript down to what the user actually asked for. Never returns
 * an empty string: a message that is ALL filler ("כן.") comes back trimmed but
 * otherwise untouched, so the caller can still react to it.
 */
export function normalizeSpoken(text: string): string {
  const trimmed = text.replace(/[‎‏]/g, "").trim();
  const t = trimmed.replace(TRAILING_PUNCT, "").replace(LEADING_FILLER, "").replace(TRAILING_PUNCT, "").trim();
  return t || trimmed;
}

// JavaScript's `\b` only knows ASCII word characters: between a Hebrew letter
// and a space (or the end of the string) there is NO boundary, so `תוציא\b`
// never matches "תוציא קבלה". The handlers' original fresh-request regex had
// exactly this bug and silently never fired. These are the Hebrew-aware
// equivalents: "not glued to another letter" on either side.
const WORD_CHAR = "[\\u0590-\\u05FF\\w]";
const W_START = `(?<!${WORD_CHAR})`;
const W_END = `(?!${WORD_CHAR})`;

const FRESH_VERB =
  "(?:תוציאי?|תפיקי?|תכיני?|הוצא|הפק|תעשי?|צרי?|תיצרי?|תרשמי?|תרשום|תנפיקי?|להוציא|להפיק|להכין|ליצור|לרשום)";
const DOC_NOUN = "(?:קבלה|הצעת מחיר|חשבונית|מסמך)";
const WANT = "(?:רוצה|צריכה?|צריך|מבקשת?|אפשר|בא לי)";

/** "תוציא ..." at the start - the typed form. */
const STARTS_WITH_VERB = new RegExp(`^${FRESH_VERB}${W_END}`);
/** "קבלה לדני על 1200" - the request led by the document noun. */
const STARTS_WITH_NOUN = new RegExp(`^${DOC_NOUN}${W_END}`);
/** A verb or a want-word within the first few words, plus a document noun anywhere: "אני רוצה שתוציא לי קבלה", "אפשר קבלה לדני". */
const HEAD_VERB = new RegExp(`${W_START}ש?(?:${FRESH_VERB}|${WANT})${W_END}`);
const HAS_NOUN = new RegExp(`${W_START}${DOC_NOUN}${W_END}`);

/**
 * "Does this message read like a brand-new document request?" Only a
 * gate: the caller still runs the full intent parser and requires a complete
 * request (name + amount) before it abandons an open draft. The bar is
 * deliberately loose because a false positive costs one extra model call
 * and a false negative traps a voice note in the correction flow.
 */
export function looksLikeFreshRequest(raw: string): boolean {
  const text = normalizeSpoken(raw);
  if (STARTS_WITH_VERB.test(text) || STARTS_WITH_NOUN.test(text)) return true;
  const head = text.split(/\s+/).slice(0, 6).join(" ");
  return HEAD_VERB.test(head) && HAS_NOUN.test(text);
}

const CANCEL = new RegExp(`^(?:לא[,.]?\\s+)?(?:בטל|ביטול|בטלי|לבטל|תבטלי?|עזוב|עזבי|cancel|stop)${W_END}`, "i");

/** "בטל", "בטלי", "תבטל את זה", "לא, בטל" - spoken or typed. */
export function isCancel(raw: string): boolean {
  return CANCEL.test(normalizeSpoken(raw));
}

/**
 * The answer to "עבור מה ה{קבלה}?" spoken as a sentence: "זה עבור ייעוץ
 * עסקי." -> "ייעוץ עסקי". A typed one-word answer passes through unchanged.
 */
export function stripDescriptionLead(raw: string): string {
  const text = normalizeSpoken(raw);
  const stripped = text
    .replace(/^(?:(?:זה|זאת|היא|הוא|הקבלה|הצעת המחיר|החשבונית|הייתה|היה|היתה)\s+)*(?:(?:עבור|בשביל|על|בעד|בגין)\s+)?/, "")
    .trim();
  return stripped || text;
}
