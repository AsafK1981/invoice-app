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
import { parseIntent, type CreateDocumentIntent } from "./intent";
import { sendText, sendButtons, sendDocument, fetchMedia } from "./client";
import { transcribeAudio, transcriptionConfigured } from "./transcribe";
import { scanExpenseEvidence, normalizeMediaType } from "@/lib/expense-scan";

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
// here does not fail loudly — it just silently stops recognising valid codes,
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
  interactive?: { button_reply?: { id: string; title: string } };
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
    // keeps costing money forever — the exact runaway the counter exists to
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

  if (msg.type === "interactive" && msg.interactive?.button_reply) {
    await handleButton(db, from, identity, msg.interactive.button_reply.id);
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
 * reply during a database blip — wrong, confusing, and billable once Meta
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
 * No account enumeration and no hints — an unrecognised message gets the same
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

  if (!anthropicKey) {
    await sendText(phone, "השירות אינו זמין כרגע. נסה שוב מאוחר יותר.");
    return;
  }

  const { intent, failed } = await parseIntent(trimmed, anthropicKey);

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
      "תמיד אראה לך את הפרטים ואחכה לאישור שלך לפני שאני מפיק משהו.",
    ].join("\n"),
  );
}

/**
 * Computes the money, writes the draft, and asks for confirmation.
 *
 * VAT is decided HERE from the business type in the database, never from the
 * message: an עוסק פטור may not charge VAT at all (create_document_for_bot
 * rejects it outright), and letting a sentence influence that would be a way to
 * talk the system into an illegal document.
 */
async function proposeDocument(
  db: SupabaseClient,
  phone: string,
  identity: Identity,
  intent: CreateDocumentIntent,
): Promise<void> {
  const { data: business, error: bizErr } = await db
    .from("businesses")
    .select("business_type")
    .eq("id", identity.business_id)
    .maybeSingle();
  if (bizErr || !business) {
    console.error("[whatsapp] business lookup failed:", bizErr?.message);
    await sendText(phone, "לא הצלחתי לטעון את פרטי העסק. נסה שוב.");
    return;
  }

  const rate =
    VAT_RATES[(business.business_type as keyof typeof VAT_RATES) ?? "exempt"] ?? 0;
  // A quote is a price proposal, not a tax document; it still shows VAT the
  // same way the app's editor does, so no special-casing is needed here.
  const money = computeMoney(intent.amount, intent.amountIncludesVat, rate);

  // Match an existing client by name so the document links to the real record
  // (and so we can reuse their phone for the forward link). Exact after
  // whitespace/case normalization, and only when exactly ONE client matches -
  // no fuzzy matching: attaching a document to the WRONG client is worse than
  // attaching it to none, and the free-text client_name still reads correctly
  // either way. Error deliberately unchecked: this lookup is an enrichment, not
  // a gate. If it fails we fall through to clientId/clientPhone null, and the
  // document is still correct - it just carries the free-text name and offers
  // the contact-picker share link instead of a direct one.
  const { data: clientRows } = await db
    .from("clients")
    .select("id, name, phone")
    .eq("business_id", identity.business_id);
  const wantedName = normalizeName(intent.clientName);
  const clientMatches = (clientRows ?? []).filter(
    (c) => normalizeName(c.name as string) === wantedName,
  );
  const client = clientMatches.length === 1 ? clientMatches[0] : null;

  const pendingId = randomUUID();
  const payload = {
    docType: intent.docType,
    clientId: client?.id ?? null,
    clientName: intent.clientName,
    clientPhone: client?.phone ?? null,
    description: intent.description,
    paymentMethod: intent.paymentMethod,
    date: intent.date,
    ...money,
  };

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

  const lines = [
    "רגע לפני שאני מפיק, תאשר שהכל נכון:",
    "",
    `*${DOC_TYPE_HE[intent.docType]}*`,
    `לקוח: ${intent.clientName}`,
  ];
  if (money.vat > 0) {
    lines.push(`לפני מע״מ: ${fmt(money.subtotal)} ₪`);
    lines.push(`מע״מ: ${fmt(money.vat)} ₪`);
  }
  lines.push(`סכום: ${fmt(money.total)} ₪`);
  if (intent.paymentMethod) lines.push(`תשלום: ${intent.paymentMethod}`);
  lines.push(`תאריך: ${formatDateHe(intent.date)}`);

  await sendButtons(phone, lines.join("\n"), [
    { id: `confirm:${pendingId}`, title: "אשר והפק" },
    { id: `cancel:${pendingId}`, title: "בטל" },
  ]);
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
  const [action, pendingId] = buttonId.split(":");
  if (!pendingId) return;

  const nowIso = new Date().toISOString();

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
    await issueDocument(db, phone, identity, pending.payload as DocumentPayload);
    return;
  }

  if (pending.kind === "expense") {
    await saveExpense(db, phone, identity, pending.payload as ExpensePayload);
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
  vendor: string;
  amount: number;
  vatAmount: number | null;
  date: string;
  category: string;
  description: string;
  /** True when the scanner could not read a date and we fell back to the
   *  send date - surfaced in the confirmation card, never silent. */
  dateAssumed?: boolean;
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

  // The bot cannot let the user edit fields, and it must NEVER save a
  // guessed vendor or amount. If either is unreadable, report what WAS read
  // and hand off to the app instead of offering a save button.
  if (!f.vendor || f.amount == null) {
    const readLines = ["קראתי את הקבלה, אבל לא בביטחון מלא:"];
    readLines.push(`ספק: ${f.vendor ?? "לא זוהה"}`);
    readLines.push(`סכום: ${f.amount != null ? `${fmt(f.amount)} ₪` : "לא זוהה"}`);
    readLines.push(`תאריך: ${f.date ? formatDateHe(f.date) : "לא זוהה"}`);
    readLines.push("");
    readLines.push(`כדי לא לשמור נתון שגוי, השלם את החסר באפליקציה: ${absoluteUrl("/expenses")}`);
    readLines.push("או שלח צילום חד יותר של הקבלה.");
    await sendText(phone, readLines.join("\n"));
    return;
  }

  const parsed: ExpensePayload = {
    vendor: f.vendor,
    amount: f.amount,
    vatAmount: f.vatAmount,
    // Date is the one field the bot must supply to save a row. When the
    // scanner could not read one we use the day the photo was sent - and
    // SAY so on the card, so the user can cancel and enter it in the app.
    date: f.date ?? today,
    dateAssumed: !f.date,
    category: f.category,
    description: f.description ?? "",
  };

  const pendingId = randomUUID();
  const { error } = await db.from("whatsapp_pending_actions").insert({
    id: pendingId,
    phone,
    user_id: identity.user_id,
    kind: "expense",
    payload: parsed,
    expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
  });
  if (error) {
    console.error("[whatsapp] expense pending insert failed:", error.message);
    await sendText(phone, "משהו השתבש. נסה שוב.");
    return;
  }

  const lines = [
    "קראתי את הקבלה:",
    "",
    `ספק: ${parsed.vendor}`,
    `סכום: ${fmt(parsed.amount)} ₪`,
  ];
  if (parsed.vatAmount) lines.push(`מע״מ: ${fmt(parsed.vatAmount)} ₪`);
  lines.push(`קטגוריה: ${parsed.category}`);
  lines.push(
    parsed.dateAssumed
      ? `תאריך: לא זוהה בקבלה - יישמר כ-${formatDateHe(parsed.date)} (היום). לתאריך אחר, בטל והזן באפליקציה.`
      : `תאריך: ${formatDateHe(parsed.date)}`,
  );
  if (f.legibility === "partial") lines.push("", "חלק מהטקסט היה קשה לקריאה - בדוק שהפרטים נכונים לפני השמירה.");

  await sendButtons(phone, lines.join("\n"), [
    { id: `confirm:${pendingId}`, title: "שמור כהוצאה" },
    { id: `cancel:${pendingId}`, title: "בטל" },
  ]);
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
    supplier: p.vendor,
    amount: p.amount,
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
  await sendText(phone, `נשמר. ✅ ההוצאה מ${p.vendor} על ${fmt(p.amount)} ₪ נרשמה.`);
}
