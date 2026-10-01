import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cronAuthError, cronAdminClient } from "@/lib/cron";
import {
  NUDGE_META,
  activationOptoutToken,
  selectActivationNudges,
  type NudgeBusiness,
  type NudgeCandidate,
  type NudgeUser,
} from "@/lib/activation-nudge";
import {
  activationOptoutUrl,
  activationSubject,
  buildActivationHtml,
  buildActivationText,
} from "./template";

export const maxDuration = 300;

/** Gmail SMTP relay allows ~500/day; stay far below it and leave room for
 *  document emails sent through the same account. */
const MAX_SENDS_PER_RUN = 50;
const PAGE = 1000;

/**
 * Daily activation nudge (vercel.json, 07:00 UTC = 09:00-10:00 in Israel).
 *
 * Two emails to owners who signed up and never produced a document: #1 on
 * day 1, #2 from day 3. Selection rules live in src/lib/activation-nudge.ts.
 *
 * OFF unless ACTIVATION_NUDGE_ENABLED is exactly "true". Off, the route only
 * reports who WOULD be emailed (counts + user ids) and sends nothing.
 *
 * Exactly once: the step's timestamp is CLAIMED in app_metadata before the
 * send; a failed send releases it so tomorrow can retry. A crash between
 * claim and send loses that one email rather than repeating it.
 *
 * Privacy: logs and this JSON carry user ids and counts only, never an
 * address.
 */
export async function GET(req: Request) {
  const unauth = cronAuthError(req);
  if (unauth) return unauth;

  const admin = cronAdminClient();
  const snapshot = await loadSnapshot(admin);
  if ("error" in snapshot) {
    return NextResponse.json({ ok: false, error: snapshot.error }, { status: 500 });
  }

  const candidates = selectActivationNudges({ ...snapshot, now: new Date() });
  const ids = (step: 1 | 2) => candidates.filter((c) => c.step === step).map((c) => c.userId);

  if (process.env.ACTIVATION_NUDGE_ENABLED !== "true") {
    const d1 = ids(1);
    const d2 = ids(2);
    console.log(`[activation-nudge] dry-run d1=${d1.length} d2=${d2.length}`);
    return NextResponse.json({
      ok: true,
      dryRun: true,
      wouldSend: { d1: { count: d1.length, ids: d1 }, d2: { count: d2.length, ids: d2 } },
    });
  }

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
    return NextResponse.json({ ok: false, error: "Gmail SMTP not configured" }, { status: 503 });
  }
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass },
  });

  const sent: string[] = [];
  const failed: string[] = [];
  for (const c of candidates.slice(0, MAX_SENDS_PER_RUN)) {
    const outcome = await sendOne(admin, transporter, gmailUser, c);
    (outcome === "sent" ? sent : failed).push(c.userId);
  }
  console.log(
    `[activation-nudge] sent=${sent.length} failed=${failed.length} deferred=${Math.max(0, candidates.length - MAX_SENDS_PER_RUN)}`,
  );
  return NextResponse.json({
    ok: true,
    dryRun: false,
    sent,
    failed,
    deferred: Math.max(0, candidates.length - MAX_SENDS_PER_RUN),
  });
}

async function sendOne(
  admin: SupabaseClient,
  transporter: nodemailer.Transporter,
  from: string,
  c: NudgeCandidate,
): Promise<"sent" | "failed"> {
  const key = c.step === 1 ? NUDGE_META.d1 : NUDGE_META.d2;

  // Claim first. app_metadata updates merge, so only this key changes.
  const claim = await admin.auth.admin.updateUserById(c.userId, {
    app_metadata: { [key]: new Date().toISOString() },
  });
  if (claim.error) {
    console.error(`[activation-nudge] claim failed user=${c.userId}`);
    return "failed";
  }

  const optoutUrl = activationOptoutUrl(c.userId, activationOptoutToken(c.userId));
  try {
    await transporter.sendMail({
      from: `"חשבונית ידידותית" <${from}>`,
      to: c.email,
      subject: activationSubject(c.step),
      html: buildActivationHtml(c.step, optoutUrl),
      text: buildActivationText(c.step, optoutUrl),
      headers: {
        "List-Unsubscribe": `<${optoutUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    return "sent";
  } catch {
    // Release the claim (null removes the key) so tomorrow retries.
    await admin.auth.admin.updateUserById(c.userId, { app_metadata: { [key]: null } });
    console.error(`[activation-nudge] send failed user=${c.userId} step=${c.step}`);
    return "failed";
  }
}

async function loadSnapshot(admin: SupabaseClient): Promise<
  | { users: NudgeUser[]; businesses: NudgeBusiness[]; businessIdsWithDocs: Set<string> }
  | { error: string }
> {
  const users: NudgeUser[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) return { error: error.message };
    const batch = data?.users ?? [];
    users.push(...(batch as unknown as NudgeUser[]));
    if (batch.length < PAGE) break;
  }

  const businesses: NudgeBusiness[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("businesses")
      .select("id,user_id")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return { error: error.message };
    businesses.push(...((data ?? []) as NudgeBusiness[]));
    if ((data ?? []).length < PAGE) break;
  }

  // Only the zero-doc question matters, so ask it per business with a head
  // count instead of pulling every document row.
  const businessIdsWithDocs = new Set<string>();
  for (const b of businesses) {
    const { count, error } = await admin
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("business_id", b.id);
    if (error) return { error: error.message };
    if ((count ?? 0) > 0) businessIdsWithDocs.add(b.id);
  }

  return { users, businesses, businessIdsWithDocs };
}
