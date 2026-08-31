// The conversation logic behind the WhatsApp channel.
//
// Split out of the route so the route stays a thin transport shell (verify
// signature, ack Meta, iterate messages) and this file holds everything that is
// actually testable without an HTTP request.
//
// The one rule that shapes all of it: THE BOT NEVER WRITES ON A PARSE. A parsed
// message becomes a row in whatsapp_pending_actions plus a button prompt; only
// a button tap calls create_document_for_bot. Israeli tax documents are
// immutable once issued and can only be undone with a credit note, so "the model
// was 95% sure" is not a good enough standard to write one.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { todayInIsrael } from "@/lib/date";
import { checkRate } from "@/lib/rate-limit";
import { VAT_RATES, round2 } from "@/lib/vat";
import { normalizeName } from "@/lib/client-picker";
import { publicDocumentUrl, absoluteUrl } from "@/lib/public-url";
import {
  parseIntent,
  parseAmendment,
  normalizePaymentMethod,
  type CreateDocumentIntent,
  type BotDocType,
} from "./intent";
import { sendText, sendButtons, sendList, sendDocument, fetchMedia } from "./client";
import { transcribeAudio, transcriptionConfigured } from "./transcribe";
import { scanExpenseEvidence, normalizeMediaType } from "@/lib/expense-scan";
import { parseExpenseEdit, parseExpenseEditSpoken, EDIT_INSTRUCTIONS } from "./expense-edit";
import { normalizeSpoken, looksLikeFreshRequest, isCancel, stripDescriptionLead } from "./spoken";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anthropicKey = process.env.ANTHROPIC_API_KEY || "";

// Mirrors MONTHLY_SCAN_CAP in /api/expenses/scan for the same reason: the
// in-memory rate limiter resets on cold start and cannot bound a month. Each
// action here costs an Anthropic call plus (from 2026-10-01) a per-message
// WhatsApp fee, so this is the ceiling on what one account can spend.
const MONTHLY_ACTION_CAP = 200;

const PENDING_TTL_MS = 30 * 60 * 1000; // 30 minutes
// Must stay in step with mintCode() in /api/whatsapp/link (4-4). A mismatch
// here does not fail loudly - it just silently stops recognising valid codes,
// so the user's binding never works and nothing is logged.
const LINK_CODE_RE = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/;

let cached: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}

// ── inbound message shapes (only the fields we use) ─────────────────────────

export interface InboundMessage {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  image?: { id: string };
  document?: { id: string };
  /** Voice notes arrive as type "audio" with voice: true; mime is audio/ogg (opus). */
  audio?: { id: string; mime_type?: string; voice?: boolean };
  interactive?: {
    button_reply?: { id: string; title: string };
    /** Reply to a sendList() picker; routed exactly like a button. */
    list_reply?: { id: string; title: string; description?: string };
  };
}

interface Identity {
  user_id: string;
  business_id: string;
}

// ── entry point ─────────────────────────────────────────────────────────────

export async function handleMessage(msg: InboundMessage): Promise<void> {
  const db = admin();
  const from = msg.from;

  // Dedupe FIRST. Meta redelivers until it sees a 200, and a redelivered
  // "confirm" tap would otherwise issue the same document twice. The unique
  // PK makes this a lock, not a check-then-act race.
  const { error: dupErr } = await db
    .from("whatsapp_processed")
    .insert({ message_id: msg.id });
  if (dupErr) {
    // 23505 = unique_violation = we already handled this one.
    if (dupErr.code === "23505") return;
    console.error("[whatsapp] dedupe insert failed:", dupErr.message);
    // Fail closed: without dedupe we could double-issue. Better to drop a
    // message than to write a document twice.
    return;
  }

  const lookup = await lookupIdentity(db, from);

  if (lookup.state === "error") {
    // Stay silent: a lookup failure is not "this number has no account" (see
    // lookupIdentity's docstring), so this must NOT fall through to
    // handleUnlinked's account-connection prompt.
    return;
  }

  if (lookup.state === "unlinked") {
    await handleUnlinked(db, from, msg);
    return;
  }

  const identity = lookup.identity;

  const { state: usage, count: usageCount } = await bumpUsage(db, identity.user_id);
  // Counter unavailable => no enforceable ceiling. Drop the message rather than
  // serve it uncapped: this channel spends real money on every reply, and "the
  // cap check itself is broken" is exactly when a loop would run up a bill
  // unnoticed. (/api/expenses/scan fails OPEN in the same spot, but there the
  // user is in the app watching it fail; here a silent loop could run for hours.)
  if (usage === "error") return;
  if (usage === "over") {
    // Tell the user ONCE, on the crossing, then go silent.
    //
    // Replying to every message past the cap is not a cap at all: each warning
    // is itself a billable outbound message, so an account that keeps typing
    // keeps costing money forever - the exact runaway the counter exists to
    // stop. increment_whatsapp_usage returns the post-increment count, so
    // "count === cap + 1" is true for exactly one message.
    if (usageCount === MONTHLY_ACTION_CAP + 1) {
      await sendText(
        from,
        `הגעת למכסה החודשית של ${MONTHLY_ACTION_CAP} פעולות בוואטסאפ. אפשר להמשיך לעבוד רגיל באפליקציה: ${absoluteUrl("/documents")}`,
      );
    }
    return;
  }

  await db
    .from("whatsapp_identities")
    .update({ last_message_at: new Date().toISOString() })
    .eq("phone", from);

  const tapped = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id;
  if (msg.type === "interactive" && tapped) {
    await handleButton(db, from, identity, tapped);
    return;
  }

  if (msg.type === "image" || msg.type === "document") {
    await handleReceiptPhoto(db, from, identity, msg);
    return;
  }

  if (msg.type === "text" && msg.text?.body) {
    await handleText(db, from, identity, msg.text.body);
    return;
  }

  if (msg.type === "audio" && msg.audio?.id) {
    await handleVoice(db, from, identity, msg);
    return;
  }

  await sendText(from, "אני יודע לקרוא הודעות טקסט, הודעות קוליות ותמונות של קבלות. שלח ״עזרה״ כדי לראות מה אפשר.");
}

// ── voice -> text -> the normal text pipeline ───────────────────────────────

/**
 * A voice note is just a text message the user did not type. Transcribe it and
 * hand the words to handleText, so every safeguard on the text path (intent
 * validation, VAT from the DB, confirm-before-issue) applies unchanged. The
 * transcript is echoed back first so the user can see what the bot heard
 * before it acts on it - a mis-heard amount must be visible, not silent.
 */
async function handleVoice(
  db: SupabaseClient,
  phone: string,
  identity: Identity,
  msg: InboundMessage,
): Promise<void> {
  if (!transcriptionConfigured()) {
    await sendText(phone, "הודעות קוליות עדיין לא זמינות כאן. כתוב לי את הבקשה בטקסט.");
    return;
  }
  const media = await fetchMedia(msg.audio!.id);
  if (!media) {
    await sendText(phone, "לא הצלחתי להוריד את ההקלטה. נסה לשלוח שוב, או כתוב לי בטקסט.");
    return;
  }
  const result = await transcribeAudio(media.base64, msg.audio?.mime_type || media.mimeType);
  if (!result.ok) {
    const why =
      result.reason === "too_large"
        ? "ההקלטה ארוכה מדי. נסה הקלטה קצרה יותר, או כתוב לי בטקסט."
        : result.reason === "empty"
          ? "לא שמעתי מילים בהקלטה. נסה שוב, או כתוב לי בטקסט."
          : "לא הצלחתי לתמלל את ההקלטה כרגע. נסה שוב, או כתוב לי בטקסט.";
    await sendText(phone, why);
    return;
  }
  await sendText(phone, `🎤 שמעתי: ״${result.text}״`);
  await handleText(db, phone, identity, result.text);
}

// ── identity ────────────────────────────────────────────────────────────────

type IdentityLookup =
  | { state: "found"; identity: Identity }
  | { state: "unlinked" }
  | { state: "error" };

/**
 * A failed lookup is NOT the same as "this number has no account".
 *
 * Collapsing the two would send every linked user a "connect your account"
 * reply during a database blip - wrong, confusing, and billable once Meta
 * starts charging for service messages on 2026-10-01. The caller stays silent
 * on "error" instead.
 */
async function lookupIdentity(db: SupabaseClient, phone: string): Promise<IdentityLookup> {
  const { data, error } = await db
    .from("whatsapp_identities")
    .select("user_id, business_id")
    .eq("phone", phone)
    .maybeSingle();
  if (error) {
    console.error("[whatsapp] identity lookup failed:", error.message);
    return { state: "error" };
  }
  if (!data) return { state: "unlinked" };
  return { state: "found", identity: data as Identity };
}

/**
 * An unknown number can do exactly one thing: redeem a link code.
 *
 * No account enumeration and no hints - an unrecognised message gets the same
 * generic instruction whether or not the sender's number belongs to a real
 * user, so the bot can't be used to test which phone numbers have accounts.
 */
async function handleUnlinked(
  db: SupabaseClient,
  phone: string,
  msg: InboundMessage,
): Promise<void> {
  // The monthly cap is keyed on user_id, which an unlinked sender does not have,
  // so without this a stranger could message the bot in a loop and every reply
  // would be billable (free until 2026-09-30, charged after). The webhook's own
  // IP limit does not help: all inbound traffic arrives from Meta's IPs, so it
  // is effectively one global bucket. Limit per PHONE instead.
  const rl = checkRate({ key: `wa-unlinked:${phone}`, max: 5, windowMs: 10 * 60_000 });
  if (!rl.ok) return;

  const body = msg.text?.body || "";
  const match = body.toUpperCase().match(LINK_CODE_RE);

  if (!match) {
    await sendText(
      phone,
      `היי. כדי לחבר את הוואטסאפ לחשבון שלך, היכנס להגדרות באפליקציה, העתק את קוד החיבור, ושלח לי אותו כאן.\n\n${absoluteUrl("/settings")}`,
    );
    return;
  }

  const code = match[1];
  const nowIso = new Date().toISOString();

  // Single-use redemption as one conditional UPDATE: `used_at IS NULL` in the
  // WHERE is what makes it atomic. A check-then-update would let two messages
  // arriving together both redeem the same code.
  const { data, error } = await db
    .from("whatsapp_link_codes")
    .update({ used_at: nowIso, used_by: phone })
    .eq("code", code)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .select("user_id, business_id")
    .maybeSingle();

  if (error || !data) {
    await sendText(phone, "הקוד לא תקף או שפג תוקפו. אפשר ליצור קוד חדש בהגדרות באפליקציה.");
    return;
  }

  const { error: bindErr } = await db.from("whatsapp_identities").insert({
    phone,
    user_id: data.user_id,
    business_id: data.business_id,
  });
  if (bindErr) {
    console.error("[whatsapp] bind failed:", bindErr.message);
    await sendText(phone, "החיבור נכשל. נסה שוב בעוד רגע.");
    return;
  }

  await sendText(
    phone,
    "מחובר. ✅\n\nעכשיו אפשר לכתוב לי למשל:\n״תוציא קבלה לדני כהן על 1200 שקל העברה בנקאית״\n\nאו פשוט לצלם קבלה של הוצאה ולשלוח לי אותה.",
  );
}

// ── usage cap ───────────────────────────────────────────────────────────────

type UsageState = "ok" | "over" | "error";

/**
 * Increments and checks this month's action count.
 *
 * Returns "error" rather than a boolean so the caller can distinguish "under
 * the cap" from "no cap is being enforced right now". Collapsing those two into
 * `false` is a billing hole: every reply on this channel costs money, so an
 * unenforceable ceiling must stop the conversation, not wave it through.
 */
async function bumpUsage(
  db: SupabaseClient,
  userId: string,
): Promise<{ state: UsageState; count: number }> {
  const month = todayInIsrael().slice(0, 7);
  const { data, error } = await db.rpc("increment_whatsapp_usage", {
    p_user_id: userId,
    p_month: month,
  });
  if (error) {
    console.error("[whatsapp] usage bump failed:", error.message);
    return { state: "error", count: 0 };
  }
  const count = Number(data);
  // A non-numeric result means the RPC is missing or changed shape. Treat that
  // as an error, not as zero: "0 > cap" is false and would silently disable the
  // ceiling entirely, which is the exact failure this counter exists to prevent.
  if (!Number.isFinite(count)) {
    console.error("[whatsapp] usage bump returned a non-number:", data);
    return { state: "error", count: 0 };
  }
  return { state: count > MONTHLY_ACTION_CAP ? "over" : "ok", count };
}

// ── text -> draft ───────────────────────────────────────────────────────────

async function handleText(
  db: SupabaseClient,
  phone: string,
  identity: Identity,
  body: string,
): Promise<void> {
  const trimmed = body.trim();

  if (/^(עזרה|help|\?)$/i.test(trimmed)) {
    await sendHelp(phone);
    return;
  }

  // An expense card in edit mode (user tapped ערוך) claims the next text
  // message(s) as field corrections. Checked BEFORE the intent parser: "סכום
  // 120" must not be read as a request to issue a 120 ₪ receipt.
  if (await applyExpenseEdit(db, phone, identity, trimmed)) return;

  if (!anthropicKey) {
    await sendText(phone, "השירות אינו זמין כרגע. נסה שוב מאוחר יותר.");
    return;
  }

  // An open draft turns the next text into an ANSWER (to the pending question)
  // or an AMENDMENT (after "לשנות", or when the user types instead of tapping),
  // not into a brand-new request. "בטל" always drops the draft. A message that
  // clearly IS a brand-new request (imperative + full name + amount) starts
  // over instead, so someone who changed their mind mid-flow is not trapped.
  const open = await loadOpenDraft(db, phone, identity);
  if (open) {
    if (isCancel(trimmed)) {
      await consumeDraft(db, open.id);
      await sendText(phone, "בוטל. לא הופק כלום.");
      return;
    }
    if (open.payload.stage === "collecting" && open.payload.pendingQuestion) {
      const fresh = await maybeFreshRequest(trimmed);
      if (fresh) {
        await consumeDraft(db, open.id);
        await proposeDocument(db, phone, identity, fresh);
        return;
      }
      await applyAnswer(db, phone, identity, open, trimmed);
      return;
    }
    // stage "amending" or "confirm": free-text correction - unless it clearly
    // is a brand-new request, in which case start over.
    const fresh = await maybeFreshRequest(trimmed);
    if (fresh) {
      await consumeDraft(db, open.id);
      await proposeDocument(db, phone, identity, fresh);
      return;
    }
    const amendment = await applyAmendment(db, phone, identity, open, trimmed);
    if (amendment.handled) return;
    // Not a correction the amendment parser could map. Before giving up, try
    // it as a fresh request WITHOUT the wording gate: a spoken "אני צריך
    // עכשיו משהו אחר, קבלה לרוני על אלף וחמש מאות" fails every regex but is a
    // complete request, and a draft that traps every following voice note
    // for 30 minutes is exactly the failure Asaf hit on 2026-08-31.
    const restated = await parseIntent(normalizeSpoken(trimmed), anthropicKey);
    if (!restated.failed && restated.intent.intent === "create_document") {
      await consumeDraft(db, open.id);
      await proposeDocument(db, phone, identity, restated.intent);
      return;
    }
    await sendText(
      phone,
      `${amendment.unknown ? amendment.unknown + "\n\n" : ""}לא הבנתי מה לשנות. אפשר לכתוב או להקליט, למשל: הסכום 1500, כולל מע״מ, זה עבור ייעוץ, תשלום בביט, או הלקוח דני לוי.\n\nכדי להתחיל מסמך חדש: ״תוציא קבלה ל... על ...״. כדי לוותר: ״בטל״.`,
    );
    return;
  }

  const { intent, failed } = await parseIntent(normalizeSpoken(trimmed), anthropicKey);

  if (failed) {
    await sendText(phone, "לא הצלחתי לעבד את ההודעה. נסה שוב בעוד רגע.");
    return;
  }

  if (intent.intent === "create_document") {
    await proposeDocument(db, phone, identity, intent);
    return;
  }

  if (intent.intent === "help") {
    await sendHelp(phone);
    return;
  }

  if (intent.intent === "status") {
    await sendText(phone, `הכל פתוח באפליקציה: ${absoluteUrl("/documents")}`);
    return;
  }

  // The user asked for a חשבונית מס. Say no explicitly instead of substituting
  // a receipt: they are different legal documents, and a silent downgrade would
  // hand the customer something they cannot use to deduct VAT.
  if (intent.intent === "unavailable_doc_type") {
    await sendText(
      phone,
      `חשבונית מס עדיין לא נתמכת בצ׳אט, כי היא עשויה לדרוש מספר הקצאה מרשות המסים.\n\nאפשר להפיק אותה באפליקציה: ${absoluteUrl("/documents/new")}\n\nכאן בצ׳אט אפשר קבלה או הצעת מחיר.`,
    );
    return;
  }

  const reason = intent.reason ? `${intent.reason}\n\n` : "";
  await sendText(
    phone,
    `${reason}נסה משהו כמו:\n״תוציא קבלה לדני כהן על 1200 שקל העברה בנקאית״\n\nצריך שם לקוח וסכום.`,
  );
}

async function sendHelp(phone: string): Promise<void> {
  await sendText(
    phone,
    [
      "מה אני יודע לעשות:",
      "",
      "📄 *להפיק מסמך*",
      "״תוציא קבלה לדני כהן על 1200 שקל העברה בנקאית״",
      "",
      "📷 *לרשום הוצאה*",
      "פשוט תצלם קבלה ותשלח לי אותה.",
      "",
      "🎤 *או פשוט להקליט*",
      "שלח הודעה קולית במקום להקליד - אני מתמלל ומטפל כרגיל.",
      "",
      "אם חסר משהו (עבור מה, מע״מ, איך שולם) אשאל אותך שאלה קצרה. בסיכום יש ״אשר והפק״, ״לשנות״ ו״בטל״ - ואפשר גם פשוט לכתוב מה לתקן.",
      "",
      "תמיד אראה לך את הפרטים ואחכה לאישור שלך לפני שאני מפיק משהו.",
    ].join("\n"),
  );
}

/**
 * The draft state machine.
 *
 *   text/voice ──parseIntent──▶ draft row (stage "collecting")
 *        │  missing description? ─▶ ask (free text)
 *        │  VAT business, VAT mode unknown? ─▶ ask (2 buttons)
 *        │  receipt, no payment method? ─▶ ask (list picker)
 *        ▼
 *   stage "confirm": summary + [אשר והפק] [לשנות] [בטל]
 *        │  "לשנות" or free text ─▶ stage "amending" ─▶ parseAmendment ─▶ back to the checks
 *        ▼
 *   confirm tap ─▶ create_document_for_bot (unchanged path)
 *
 * The draft lives in ONE whatsapp_pending_actions row (kind "document") whose
 * payload is rewritten as the conversation advances; the row id is stable so
 * the confirm/cancel button ids stay valid and the consumed_at guard against
 * double-issue keeps working. VAT is decided HERE from the business type in
 * the database, never from the message: an עוסק פטור may not charge VAT at all
 * (create_document_for_bot rejects it outright), and letting a sentence
 * influence that would be a way to talk the system into an illegal document.
 */

type Stage = "collecting" | "amending" | "confirm";
type Question = "description" | "vat" | "payment" | "payment_other";

interface DraftPayload extends Money {
  stage: Stage;
  pendingQuestion: Question | null;
  docType: BotDocType;
  clientId: string | null;
  clientName: string;
  clientPhone: string | null;
  clientKnown: boolean;
  description: string;
  descriptionGiven: boolean;
  paymentMethod: string | null;
  date: string;
  amount: number;
  amountIncludesVat: boolean | null;
  vatRate: number;
}

interface OpenDraft {
  id: string;
  payload: DraftPayload;
}

const PAYMENT_ROWS = ["מזומן", "העברה בנקאית", "אשראי", "ביט", "צ׳ק", "פייפאל"];

/** Newest live document draft for this phone, or null. Errors read as "no draft" (the text then starts a fresh request, which is the safe default). */
async function loadOpenDraft(
  db: SupabaseClient,
  phone: string,
  identity: Identity,
): Promise<OpenDraft | null> {
  const { data, error } = await db
    .from("whatsapp_pending_actions")
    .select("id, payload")
    .eq("phone", phone)
    .eq("user_id", identity.user_id)
    .eq("kind", "document")
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const p = data.payload as Partial<DraftPayload>;
  // Rows written before the state machine existed have no stage: treat them as
  // a finished summary awaiting a tap (the only thing they ever were).
  if (!p.stage) return { id: data.id as string, payload: { ...(p as DraftPayload), stage: "confirm", pendingQuestion: null } };
  return { id: data.id as string, payload: p as DraftPayload };
}

async function consumeDraft(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db
    .from("whatsapp_pending_actions")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", id)
    .is("consumed_at", null);
  if (error) console.error("[whatsapp] consume draft failed:", error.message);
}

async function saveDraft(db: SupabaseClient, id: string, payload: DraftPayload, phone?: string): Promise<boolean> {
  const { error } = await db
    .from("whatsapp_pending_actions")
    .update({ payload, expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString() })
    .eq("id", id)
    .is("consumed_at", null);
  if (error) {
    console.error("[whatsapp] save draft failed:", error.message);
    if (phone) await sendText(phone, "משהו השתבש בשמירת הטיוטה. נסה שוב.");
  }
  return !error;
}

/**
 * "Did the user just start over?" Only when the message reads like a command
 * AND parses into a complete request; a plain answer ("ייעוץ עסקי") never does.
 * The wording gate accepts spoken forms too ("אני רוצה שתוציאי לי קבלה...").
 */
async function maybeFreshRequest(text: string): Promise<CreateDocumentIntent | null> {
  if (!looksLikeFreshRequest(text)) return null;
  const { intent, failed } = await parseIntent(normalizeSpoken(text), anthropicKey);
  if (failed || intent.intent !== "create_document") return null;
  return intent;
}

async function loadVatRate(db: SupabaseClient, businessId: string): Promise<number | null> {
  const { data: business, error } = await db
    .from("businesses")
    .select("business_type")
    .eq("id", businessId)
    .maybeSingle();
  if (error || !business) {
    console.error("[whatsapp] business lookup failed:", error?.message);
    return null;
  }
  return VAT_RATES[(business.business_type as keyof typeof VAT_RATES) ?? "exempt"] ?? 0;
}

/**
 * Match an existing client by name so the document links to the real record
 * (and so we can reuse their phone for the forward link). Exact after
 * whitespace/case normalization, and only when exactly ONE client matches -
 * no fuzzy matching: attaching a document to the WRONG client is worse than
 * attaching it to none. Error deliberately unchecked: this is an enrichment,
 * not a gate.
 */
async function matchClient(
  db: SupabaseClient,
  businessId: string,
  clientName: string,
): Promise<{ id: string; phone: string | null } | null> {
  const { data: clientRows } = await db
    .from("clients")
    .select("id, name, phone")
    .eq("business_id", businessId);
  const wantedName = normalizeName(clientName);
  const matches = (clientRows ?? []).filter((c) => normalizeName(c.name as string) === wantedName);
  return matches.length === 1 ? { id: matches[0].id as string, phone: (matches[0].phone as string) ?? null } : null;
}

/** First step: a fresh intent becomes a draft row, then the questions run. */
async function proposeDocument(
  db: SupabaseClient,
  phone: string,
  identity: Identity,
  intent: CreateDocumentIntent,
): Promise<void> {
  const rate = await loadVatRate(db, identity.business_id);
  if (rate === null) {
    await sendText(phone, "לא הצלחתי לטעון את פרטי העסק. נסה שוב.");
    return;
  }
  const client = await matchClient(db, identity.business_id, intent.clientName);
  const money = computeMoney(intent.amount, intent.amountIncludesVat === true, rate);

  const payload: DraftPayload = {
    stage: "collecting",
    pendingQuestion: null,
    docType: intent.docType,
    clientId: client?.id ?? null,
    clientName: intent.clientName,
    clientPhone: client?.phone ?? null,
    clientKnown: Boolean(client),
    description: intent.description ?? "",
    descriptionGiven: Boolean(intent.description),
    paymentMethod: intent.paymentMethod,
    date: intent.date,
    amount: intent.amount,
    amountIncludesVat: intent.amountIncludesVat,
    vatRate: rate,
    ...money,
  };

  const pendingId = randomUUID();
  const { error: pendErr } = await db.from("whatsapp_pending_actions").insert({
    id: pendingId,
    phone,
    user_id: identity.user_id,
    kind: "document",
    payload,
    expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
  });
  if (pendErr) {
    console.error("[whatsapp] pending insert failed:", pendErr.message);
    await sendText(phone, "משהו השתבש. נסה שוב.");
    return;
  }

  await advanceDraft(db, phone, { id: pendingId, payload });
}

/** Which question is still open, in the order they are asked. */
function nextQuestion(p: DraftPayload): Question | null {
  if (!p.descriptionGiven) return "description";
  if (p.vatRate > 0 && p.amountIncludesVat === null) return "vat";
  if (p.docType === "receipt" && !p.paymentMethod) return "payment";
  return null;
}

/** Recomputes money from the raw fields (after any answer/amendment). */
function withMoney(p: DraftPayload): DraftPayload {
  const money = computeMoney(p.amount, p.amountIncludesVat === true, p.vatRate);
  return { ...p, ...money };
}

/**
 * Asks the next missing question, or presents the summary with 3 buttons.
 * Every branch persists the new stage BEFORE sending, so a reply that arrives
 * fast (or a retry) sees the right state.
 */
async function advanceDraft(db: SupabaseClient, phone: string, draft: OpenDraft): Promise<void> {
  const p = withMoney(draft.payload);
  const q = nextQuestion(p);
  const label = DOC_TYPE_HE[p.docType] || "מסמך";

  if (q === "description") {
    if (!(await saveDraft(db, draft.id, { ...p, stage: "collecting", pendingQuestion: "description" }, phone))) return;
    const forWhat = p.docType === "quote" ? "הצעת המחיר" : `ה${label}`;
    await sendText(phone, `עבור מה ${forWhat}? (למשל: ייעוץ עסקי, צילום אירוע, שיעור פרטי)`);
    return;
  }
  if (q === "vat") {
    if (!(await saveDraft(db, draft.id, { ...p, stage: "collecting", pendingQuestion: "vat" }, phone))) return;
    await sendButtons(phone, `הסכום ${fmt(p.amount)} ₪ - כולל מע״מ או לפני מע״מ?`, [
      { id: `vat_incl:${draft.id}`, title: "כולל מע״מ" },
      { id: `vat_excl:${draft.id}`, title: "לפני מע״מ" },
    ]);
    return;
  }
  if (q === "payment") {
    if (!(await saveDraft(db, draft.id, { ...p, stage: "collecting", pendingQuestion: "payment" }, phone))) return;
    await sendList(
      phone,
      "איך שולם?",
      "בחר אמצעי תשלום",
      [...PAYMENT_ROWS.map((m, i) => ({ id: `pay:${draft.id}:${i}`, title: m })), { id: `pay:${draft.id}:other`, title: "אחר" }],
    );
    return;
  }

  if (!(await saveDraft(db, draft.id, { ...p, stage: "confirm", pendingQuestion: null }, phone))) return;
  const lines = [
    "רגע לפני שאני מפיק, תאשר שהכל נכון:",
    "",
    `*${label}*`,
    `לקוח: ${p.clientName}${p.clientKnown ? "" : " (לקוח חדש)"}`,
    `עבור: ${p.description}`,
  ];
  if (p.vat > 0) {
    lines.push(`לפני מע״מ: ${fmt(p.subtotal)} ₪`);
    lines.push(`מע״מ: ${fmt(p.vat)} ₪`);
  }
  lines.push(`סכום: ${fmt(p.total)} ₪`);
  if (p.paymentMethod) lines.push(`תשלום: ${p.paymentMethod}`);
  lines.push(`תאריך: ${formatDateHe(p.date)}`);
  lines.push("", "לא מדויק? לחץ ״לשנות״ או פשוט כתוב מה לתקן.");

  await sendButtons(phone, lines.join("\n"), [
    { id: `confirm:${draft.id}`, title: "אשר והפק" },
    { id: `edit:${draft.id}`, title: "לשנות" },
    { id: `cancel:${draft.id}`, title: "בטל" },
  ]);
}

/** Free-text answer to the pending question. */
async function applyAnswer(
  db: SupabaseClient,
  phone: string,
  identity: Identity,
  draft: OpenDraft,
  text: string,
): Promise<void> {
  const p = draft.payload;
  switch (p.pendingQuestion) {
    case "description": {
      // Spoken answers are sentences: "זה עבור ייעוץ עסקי." -> "ייעוץ עסקי".
      const d = stripDescriptionLead(text).slice(0, 200);
      if (d.length < 2) {
        await sendText(phone, "כתוב במילה או שתיים עבור מה זה (למשל: ייעוץ).");
        return;
      }
      await advanceDraft(db, phone, { id: draft.id, payload: { ...p, description: d, descriptionGiven: true } });
      return;
    }
    case "vat": {
      // The user typed (or said) instead of tapping: accept the words too.
      // Exclusions FIRST: "לא כולל מע״מ" contains "כולל".
      if (/לפני|פלוס|בתוספת|לא כולל|בלי|ללא|בלי מע|נטו/.test(text)) {
        await advanceDraft(db, phone, { id: draft.id, payload: { ...p, amountIncludesVat: false } });
        return;
      }
      if (/כולל/.test(text)) {
        await advanceDraft(db, phone, { id: draft.id, payload: { ...p, amountIncludesVat: true } });
        return;
      }
      await sendButtons(phone, `לא הבנתי. הסכום ${fmt(p.amount)} ₪ - כולל מע״מ או לפני מע״מ?`, [
        { id: `vat_incl:${draft.id}`, title: "כולל מע״מ" },
        { id: `vat_excl:${draft.id}`, title: "לפני מע״מ" },
      ]);
      return;
    }
    case "payment":
    case "payment_other": {
      const method = normalizePaymentMethod(text);
      if (!method) {
        await sendText(phone, "איך שולם? כתוב במילים (למשל: ביט, מזומן, העברה).");
        return;
      }
      await advanceDraft(db, phone, { id: draft.id, payload: { ...p, paymentMethod: method } });
      return;
    }
    default: {
      const r = await applyAmendment(db, phone, identity, draft, text);
      if (!r.handled) await sendText(phone, `${r.unknown ? r.unknown + "\n\n" : ""}לא הבנתי מה לשנות. כתוב או הקלט למשל: הסכום 1500, כולל מע״מ, זה עבור ייעוץ, תשלום בביט, או הלקוח דני לוי.`);
    }
  }
}

/**
 * Free-text correction of a draft (after "לשנות", or typed at the summary).
 * `handled: false` only when the parser could not map the message to any
 * field (with the model's Hebrew reason, if it gave one), so the caller can
 * try it as a fresh request before telling the user no.
 */
async function applyAmendment(
  db: SupabaseClient,
  phone: string,
  identity: Identity,
  draft: OpenDraft,
  text: string,
): Promise<{ handled: boolean; unknown?: string }> {
  const p = draft.payload;
  const { patch, unknown, failed } = await parseAmendment(
    normalizeSpoken(text),
    {
      docType: p.docType,
      clientName: p.clientName,
      amount: p.amount,
      amountIncludesVat: p.amountIncludesVat,
      paymentMethod: p.paymentMethod,
      description: p.description || null,
      date: p.date,
    },
    anthropicKey,
  );
  if (failed) {
    await sendText(phone, "לא הצלחתי לעבד את התיקון. נסה שוב בעוד רגע.");
    return { handled: true };
  }
  if (unknown || Object.keys(patch).length === 0) {
    await saveDraft(db, draft.id, { ...p, stage: "amending", pendingQuestion: null });
    // The generic "לא הבנתי מה לשנות." is the caller's line; only a specific
    // reason (e.g. "חשבונית מס לא זמינה") is worth passing up.
    const specific = unknown && !/^לא הבנתי מה לשנות/.test(unknown) ? unknown : undefined;
    return { handled: false, unknown: specific };
  }

  let next: DraftPayload = { ...p };
  if (patch.docType) next.docType = patch.docType;
  if (patch.clientName) {
    const client = await matchClient(db, identity.business_id, patch.clientName);
    next.clientName = patch.clientName;
    next.clientId = client?.id ?? null;
    next.clientPhone = client?.phone ?? null;
    next.clientKnown = Boolean(client);
  }
  if (patch.amount !== undefined) next.amount = patch.amount;
  if (patch.amountIncludesVat !== undefined) next.amountIncludesVat = patch.amountIncludesVat;
  if (patch.paymentMethod !== undefined) next.paymentMethod = patch.paymentMethod;
  if (patch.description) {
    next.description = patch.description;
    next.descriptionGiven = true;
  }
  if (patch.date) next.date = patch.date;
  next = withMoney(next);

  // Re-run the missing checks: an amendment can open a question (a receipt
  // whose payment method was cleared) or close one.
  await advanceDraft(db, phone, { id: draft.id, payload: { ...next, stage: "collecting", pendingQuestion: null } });
  return { handled: true };
}

export interface Money {
  subtotal: number;
  vat: number;
  total: number;
}

/**
 * Splits a stated amount into subtotal/VAT/total.
 *
 * Exported for tests: this is the arithmetic that ends up on a legal document,
 * and it must satisfy the same invariant create_document_for_bot enforces
 * (total = subtotal + vat, to the agora), including after rounding.
 */
export function computeMoney(
  amount: number,
  includesVat: boolean,
  ratePercent: number,
): Money {
  if (ratePercent <= 0) {
    const total = round2(amount);
    return { subtotal: total, vat: 0, total };
  }
  if (includesVat) {
    const total = round2(amount);
    const subtotal = round2(total / (1 + ratePercent / 100));
    // Derive VAT by subtraction rather than by its own rounding, so the two
    // roundings can never drift apart and trip the RPC's invariant check.
    return { subtotal, vat: round2(total - subtotal), total };
  }
  const subtotal = round2(amount);
  const vat = round2(subtotal * (ratePercent / 100));
  return { subtotal, vat, total: round2(subtotal + vat) };
}

function fmt(n: number): string {
  return n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateHe(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// Only the two types this channel can issue. Deliberately NOT a full map of
// DocumentType: an entry here for a type the RPC rejects would let a draft be
// rendered and confirmed before failing at the write.
const DOC_TYPE_HE: Record<string, string> = {
  receipt: "קבלה",
  quote: "הצעת מחיר",
};

// ── button taps ─────────────────────────────────────────────────────────────

async function handleButton(
  db: SupabaseClient,
  phone: string,
  identity: Identity,
  buttonId: string,
): Promise<void> {
  const [action, pendingId, extra] = buttonId.split(":");
  if (!pendingId) return;

  const nowIso = new Date().toISOString();

  // Mid-flow taps (VAT choice, payment picker, "לשנות") advance the draft
  // WITHOUT consuming it - consumption is reserved for confirm/cancel so the
  // double-issue guard below keeps its meaning.
  if (action === "edit" || action === "vat_incl" || action === "vat_excl" || action === "pay") {
    const open = await loadOpenDraft(db, phone, identity);
    const isThisDraft = Boolean(open && open.id === pendingId);
    if (!isThisDraft && action !== "edit") {
      await sendText(phone, "הבקשה כבר טופלה או שפג תוקפה. אפשר לשלוח אותה מחדש.");
      return;
    }
    // "edit" is shared with the expense card (kind "expense"): when the id is
    // not an open DOCUMENT draft, fall through to the expense edit path below.
    if (isThisDraft) {
    const p = open!.payload;
    if (action === "edit") {
      if (!(await saveDraft(db, open!.id, { ...p, stage: "amending", pendingQuestion: null }))) return;
      await sendText(
        phone,
        "מה לשנות? כתוב בחופשיות, למשל:\nהסכום 1500 / כולל מע״מ / זה עבור ייעוץ / תשלום בביט / הלקוח דני לוי / תאריך אתמול",
      );
      return;
    }
    if (action === "vat_incl" || action === "vat_excl") {
      await advanceDraft(db, phone, { id: open!.id, payload: { ...p, amountIncludesVat: action === "vat_incl" } });
      return;
    }
    // action === "pay"
    if (extra === "other") {
      if (!(await saveDraft(db, open!.id, { ...p, stage: "collecting", pendingQuestion: "payment_other" }))) return;
      await sendText(phone, "איך שולם? כתוב במילים (למשל: הוראת קבע, המחאה בנקאית).");
      return;
    }
    const method = PAYMENT_ROWS[Number(extra)];
    if (!method) return;
    await advanceDraft(db, phone, { id: open!.id, payload: { ...p, paymentMethod: method } });
    return;
    }
  }

  if (action === "edit") {
    await enterExpenseEdit(db, phone, identity, pendingId, nowIso);
    return;
  }

  // Consume the draft with a conditional UPDATE for the same reason the link
  // code is consumed that way: `consumed_at IS NULL` in the WHERE is what makes
  // a double tap (or a webhook redelivery that slipped past dedupe) issue one
  // document instead of two. Scoped to this phone AND this user so a guessed
  // pending id from another account is a miss, not a write.
  const { data: pending, error } = await db
    .from("whatsapp_pending_actions")
    .update({ consumed_at: nowIso })
    .eq("id", pendingId)
    .eq("phone", phone)
    .eq("user_id", identity.user_id)
    .is("consumed_at", null)
    .gt("expires_at", nowIso)
    .select("kind, payload")
    .maybeSingle();

  if (error || !pending) {
    await sendText(phone, "הבקשה כבר טופלה או שפג תוקפה. אפשר לשלוח אותה מחדש.");
    return;
  }

  if (action === "cancel") {
    await sendText(phone, "בוטל. לא הופק כלום.");
    return;
  }

  if (action !== "confirm") return;

  if (pending.kind === "document") {
    // An OLD summary's "אשר והפק" button stays tappable in the chat after the
    // user amended the draft and a new question opened. Never issue a draft
    // that is not at the confirm stage: hand the row back and re-ask instead.
    const draft = pending.payload as DraftPayload;
    if (draft.stage && draft.stage !== "confirm") {
      const { error: revertErr } = await db
        .from("whatsapp_pending_actions")
        .update({ consumed_at: null })
        .eq("id", pendingId);
      if (revertErr) {
        console.error("[whatsapp] draft revert failed:", revertErr.message);
        await sendText(phone, "הבקשה כבר טופלה או שפג תוקפה. אפשר לשלוח אותה מחדש.");
        return;
      }
      await advanceDraft(db, phone, { id: pendingId, payload: draft });
      return;
    }
    await issueDocument(db, phone, identity, pending.payload as DocumentPayload);
    return;
  }

  if (pending.kind === "expense") {
    const p = pending.payload as ExpensePayload;
    if (!p.vendor || p.amount == null) {
      // Can only happen by tapping "save" on a stale card, since incomplete
      // cards are not given a save button. Never write a half-read expense.
      await sendText(phone, "חסר ספק או סכום, אז לא שמרתי. שלח את הקבלה שוב ולחץ ״ערוך״ כדי להשלים.");
      return;
    }
    await saveExpense(db, phone, identity, p);
  }
}

interface DocumentPayload extends Money {
  docType: string;
  clientId: string | null;
  clientName: string;
  clientPhone: string | null;
  description: string;
  paymentMethod: string | null;
  date: string;
}

async function issueDocument(
  db: SupabaseClient,
  phone: string,
  identity: Identity,
  p: DocumentPayload,
): Promise<void> {
  const docId = randomUUID();
  const items = [
    {
      id: randomUUID(),
      description: p.description,
      quantity: 1,
      unit_price: p.subtotal,
      total: p.subtotal,
    },
  ];

  const { data, error } = await db.rpc("create_document_for_bot", {
    p_user_id: identity.user_id,
    p_business_id: identity.business_id,
    p_id: docId,
    p_type: p.docType,
    p_date: p.date,
    p_client_id: p.clientId,
    p_client_name: p.clientName,
    p_subject: p.description,
    // Only a receipt and a tax-invoice-receipt represent money RECEIVED. A bare
    // tax_invoice is a demand for payment and a quote is a proposal; marking
    // either "paid" would inflate income, and worse, double-count it when the
    // matching receipt is issued later (see the revenue model: income counts
    // paid documents, and an invoice→receipt pair must only count once).
    p_status: p.docType === "receipt" ? "paid" : "sent",
    p_subtotal: p.subtotal,
    p_vat: p.vat,
    p_total: p.total,
    p_payment_method: p.paymentMethod,
    p_notes: null,
    p_items: items,
  });

  if (error) {
    console.error("[whatsapp] issue failed:", error.message);
    await sendText(phone, "ההפקה נכשלה. המסמך לא נוצר. אפשר לנסות שוב או להפיק באפליקציה.");
    return;
  }

  const number = (data as { number?: number } | null)?.number;
  const label = DOC_TYPE_HE[p.docType] || "מסמך";
  const viewUrl = publicDocumentUrl(docId);

  await sendDocument(
    phone,
    absoluteUrl(`/api/documents/${docId}/pdf`),
    `${p.docType}-${number ?? ""}.pdf`,
    `${label} ${number ?? ""} הופקה ונשמרה. ✅`,
  );

  // The forward link is the whole cost model of this feature. We do NOT message
  // the end customer from the app's number: they never opted in, so it would be
  // a billable marketing template (~₪0.31 each) AND an unsolicited commercial
  // message under חוק התקשורת סעיף 30א. Instead the USER forwards it from their
  // own WhatsApp, which is free, arrives from a number the customer already has
  // saved, and carries no consent problem.
  const shareText = `היי ${p.clientName}, מצורפת ${label} על ${fmt(p.total)} ₪. תודה!\n${viewUrl}`;
  const target = p.clientPhone ? normalizePhone(p.clientPhone) : "";
  const waLink = `https://wa.me/${target}?text=${encodeURIComponent(shareText)}`;

  await sendText(phone, `👉 שלח את ה${label} ל${p.clientName}:\n${waLink}`);
}

/** Israeli local (05X…) to E.164 digits, which is what wa.me expects. */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("972")) return digits;
  if (digits.startsWith("0")) return `972${digits.slice(1)}`;
  return digits;
}

// ── photo -> expense ────────────────────────────────────────────────────────

interface ExpensePayload {
  /** null = the scanner could not read it and the user has not filled it yet.
   *  A card with a null vendor or amount gets no "save" button. */
  vendor: string | null;
  amount: number | null;
  vatAmount: number | null;
  date: string;
  category: string;
  description: string;
  /** True when the scanner could not read a date and we fell back to the
   *  send date - surfaced in the confirmation card, never silent. */
  dateAssumed?: boolean;
  /** Set when the user tapped ערוך: the next text message is a correction. */
  editing?: boolean;
  /** Which fields the scanner could not read (Hebrew names), for the card. */
  unreadFields?: string[];
}

async function handleReceiptPhoto(
  db: SupabaseClient,
  phone: string,
  identity: Identity,
  msg: InboundMessage,
): Promise<void> {
  const mediaId = msg.image?.id || msg.document?.id;
  if (!mediaId || !anthropicKey) {
    await sendText(phone, "לא הצלחתי לקרוא את הקובץ. נסה לצלם שוב.");
    return;
  }

  const media = await fetchMedia(mediaId);
  if (!media) {
    await sendText(phone, "לא הצלחתי להוריד את התמונה. נסה לשלוח שוב.");
    return;
  }

  const today = todayInIsrael();
  let outcome;
  try {
    outcome = await scanExpenseEvidence({
      apiKey: anthropicKey,
      data: media.base64,
      mediaType: normalizeMediaType(media.mimeType),
      today,
    });
  } catch (err) {
    console.error("[whatsapp] receipt scan failed:", err instanceof Error ? err.message : err);
    await sendText(phone, "הזיהוי נכשל כרגע. נסה שוב בעוד רגע, או הזן ידנית באפליקציה.");
    return;
  }

  if (!outcome.ok) {
    await sendText(
      phone,
      outcome.reason === "not_expense"
        ? "זה לא נראה כמו קבלה או אסמכתה לתשלום. אם זו כן הוצאה - אפשר להזין ידנית באפליקציה."
        : "לא הצלחתי לקרוא את הקבלה בביטחון. אפשר לצלם שוב בתאורה טובה (כל הקבלה בפריים, בלי צל), או להזין ידנית באפליקציה.",
    );
    return;
  }

  const f = outcome.fields;
  const payload: ExpensePayload = {
    // Never guessed: a field the scanner could not read stays null and the
    // card offers ערוך instead of a save button until the user fills it.
    vendor: f.vendor,
    amount: f.amount,
    vatAmount: f.vatAmount,
    // Date is the one field the bot must supply to save a row. When the
    // scanner could not read one we use the day the photo was sent - and
    // SAY so on the card, so the user can tap ערוך and correct it.
    date: f.date ?? today,
    dateAssumed: !f.date,
    category: f.category,
    description: f.description ?? "",
    unreadFields: f.unreadFields,
  };

  const pendingId = randomUUID();
  const { error } = await db.from("whatsapp_pending_actions").insert({
    id: pendingId,
    phone,
    user_id: identity.user_id,
    kind: "expense",
    payload,
    expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
  });
  if (error) {
    console.error("[whatsapp] expense pending insert failed:", error.message);
    await sendText(phone, "משהו השתבש. נסה שוב.");
    return;
  }

  await sendExpenseCard(phone, pendingId, payload, f.legibility === "partial");
}

/**
 * The confirmation card. Complete payload → שמור / ערוך / בטל. Missing vendor
 * or amount → ערוך / בטל only, with the missing fields marked, so a half-read
 * receipt can be completed in chat instead of bounced to the app.
 */
async function sendExpenseCard(
  phone: string,
  pendingId: string,
  p: ExpensePayload,
  partialWarning = false,
): Promise<void> {
  const complete = !!p.vendor && p.amount != null;
  const lines = [complete ? "קראתי את הקבלה:" : "קראתי את הקבלה, אבל לא הכל:", ""];
  lines.push(`ספק: ${p.vendor ?? "לא זוהה ⚠️"}`);
  lines.push(`סכום: ${p.amount != null ? `${fmt(p.amount)} ₪` : "לא זוהה ⚠️"}`);
  if (p.vatAmount) lines.push(`מע״מ: ${fmt(p.vatAmount)} ₪`);
  lines.push(`קטגוריה: ${p.category}`);
  lines.push(
    p.dateAssumed
      ? `תאריך: לא זוהה בקבלה - יישמר כ-${formatDateHe(p.date)} (היום) ⚠️`
      : `תאריך: ${formatDateHe(p.date)}`,
  );
  if (p.description) lines.push(`תיאור: ${p.description}`);
  if (!complete) lines.push("", "לחץ ״ערוך״ כדי להשלים את מה שחסר.");
  else if (partialWarning || p.dateAssumed) lines.push("", "לא בטוח בהכל? ״ערוך״ מאפשר לתקן כל שדה לפני השמירה.");

  const buttons = complete
    ? [
        { id: `confirm:${pendingId}`, title: "שמור כהוצאה" },
        { id: `edit:${pendingId}`, title: "ערוך" },
        { id: `cancel:${pendingId}`, title: "בטל" },
      ]
    : [
        { id: `edit:${pendingId}`, title: "ערוך" },
        { id: `cancel:${pendingId}`, title: "בטל" },
      ];
  await sendButtons(phone, lines.join("\n"), buttons);
}

/**
 * ערוך tapped: flag the pending row so the next text message is treated as
 * corrections, and extend its life. Does NOT consume the row - the old card's
 * buttons keep working against the (updated) payload.
 */
async function enterExpenseEdit(
  db: SupabaseClient,
  phone: string,
  identity: Identity,
  pendingId: string,
  nowIso: string,
): Promise<void> {
  const { data: row } = await db
    .from("whatsapp_pending_actions")
    .select("payload")
    .eq("id", pendingId)
    .eq("phone", phone)
    .eq("user_id", identity.user_id)
    .eq("kind", "expense")
    .is("consumed_at", null)
    .gt("expires_at", nowIso)
    .maybeSingle();
  if (!row) {
    await sendText(phone, "הבקשה כבר טופלה או שפג תוקפה. שלח את הקבלה שוב.");
    return;
  }
  const payload = { ...(row.payload as ExpensePayload), editing: true };
  await db
    .from("whatsapp_pending_actions")
    .update({ payload, expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString() })
    .eq("id", pendingId);
  await sendText(phone, EDIT_INSTRUCTIONS);
}

/**
 * If this phone has an expense card in edit mode, apply the text as field
 * corrections and re-send the card. Returns true when the message was
 * consumed by the edit flow (so the caller must not run the intent parser).
 */
async function applyExpenseEdit(
  db: SupabaseClient,
  phone: string,
  identity: Identity,
  text: string,
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const { data: row } = await db
    .from("whatsapp_pending_actions")
    .select("id, payload")
    .eq("phone", phone)
    .eq("user_id", identity.user_id)
    .eq("kind", "expense")
    .is("consumed_at", null)
    .gt("expires_at", nowIso)
    .eq("payload->>editing", "true")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row) return false;

  const current = row.payload as ExpensePayload;

  if (isCancel(text)) {
    await db.from("whatsapp_pending_actions").update({ consumed_at: nowIso }).eq("id", row.id);
    await sendText(phone, "בוטל. ההוצאה לא נשמרה.");
    return true;
  }

  const today = todayInIsrael();
  let { patch, unrecognized } = parseExpenseEdit(text, today);

  if (Object.keys(patch).length === 0) {
    // Edit mode must not become a trap. A message that reads like a new
    // document request ("תוציא קבלה לדני על 1200") leaves edit mode and falls
    // through to the normal pipeline, instead of being quoted back as "לא
    // הבנתי מה לשנות" until the card expires.
    if (looksLikeFreshRequest(text)) {
      await db
        .from("whatsapp_pending_actions")
        .update({ payload: { ...current, editing: false } })
        .eq("id", row.id);
      return false;
    }

    // The keyword lines found nothing: this is a sentence (usually a voice
    // note). Let the model map it, on the same rails as the typed path.
    if (anthropicKey) {
      const spoken = await parseExpenseEditSpoken(
        normalizeSpoken(text),
        { vendor: current.vendor, amount: current.amount, vatAmount: current.vatAmount, date: current.date, category: current.category, description: current.description },
        today,
        anthropicKey,
      );
      if (spoken.failed) {
        await sendText(phone, "לא הצלחתי לעבד את התיקון כרגע. נסה שוב בעוד רגע.");
        return true;
      }
      if (Object.keys(spoken.patch).length > 0) {
        patch = spoken.patch;
        unrecognized = [];
      }
    }
  }

  if (Object.keys(patch).length === 0) {
    await sendText(
      phone,
      `לא הבנתי מה לשנות ב:\n${unrecognized.map((l) => `״${l}״`).join("\n")}\n\n${EDIT_INSTRUCTIONS}`,
    );
    return true;
  }

  const next: ExpensePayload = {
    ...current,
    ...(patch.vendor !== undefined ? { vendor: patch.vendor } : {}),
    ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
    ...(patch.vatAmount !== undefined ? { vatAmount: patch.vatAmount } : {}),
    ...(patch.date !== undefined ? { date: patch.date, dateAssumed: false } : {}),
    ...(patch.category !== undefined ? { category: patch.category } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    editing: false,
  };
  if (next.vatAmount != null && next.amount != null && next.vatAmount >= next.amount) {
    await sendText(phone, "המע״מ לא יכול להיות גדול או שווה לסכום. שלח שוב.");
    return true;
  }
  next.unreadFields = [
    ...(next.vendor ? [] : ["ספק"]),
    ...(next.amount != null ? [] : ["סכום"]),
    ...(next.dateAssumed ? ["תאריך"] : []),
  ];

  await db
    .from("whatsapp_pending_actions")
    .update({ payload: next, expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString() })
    .eq("id", row.id);

  if (unrecognized.length > 0) {
    await sendText(phone, `עדכנתי, אבל לא הבנתי: ${unrecognized.map((l) => `״${l}״`).join(", ")}`);
  }
  await sendExpenseCard(phone, row.id, next);
  return true;
}

async function saveExpense(
  db: SupabaseClient,
  phone: string,
  identity: Identity,
  p: ExpensePayload,
): Promise<void> {
  const { error } = await db.from("expenses").insert({
    id: randomUUID(),
    business_id: identity.business_id,
    date: p.date,
    category: p.category,
    supplier: p.vendor!,
    amount: p.amount!,
    // The VAT is parsed off the receipt, validated, and SHOWN to the user in
    // the confirmation card, so omitting it here silently contradicted what
    // they approved. It also feeds input-VAT credit on the periodic VAT return
    // (see 20260504-expenses-vat.sql), so dropping it understates a real
    // deduction for every עוסק מורשה who scans a receipt through the bot.
    vat_amount: p.vatAmount ?? 0,
    description: p.description,
  });
  if (error) {
    console.error("[whatsapp] expense insert failed:", error.message);
    await sendText(phone, "שמירת ההוצאה נכשלה. נסה שוב.");
    return;
  }
  await sendText(phone, `נשמר. ✅ ההוצאה מ${p.vendor} על ${fmt(p.amount!)} ₪ נרשמה.`);
}
