// One-off preview of the activation email, sent ONLY to the owner.
//
//   npx tsx scripts/send-activation-preview.mjs
//
// Renders the template (src/app/api/cron/activation-nudge/template.ts) for a
// dummy user id and sends them through the same Gmail SMTP relay and FROM
// line the app uses, with the subject prefixed "[תצוגה מקדימה 3] ". The
// recipient is hard-coded; any attempt to point it elsewhere is refused.
// Run with tsx (not plain node): it imports the TypeScript templates.
import { readFileSync } from "node:fs";
import nodemailer from "nodemailer";

const RECIPIENT = "asafkotlar@gmail.com";
const DUMMY_USER_ID = "00000000-0000-4000-8000-000000000000";

const override = process.argv.slice(2).find((a) => a.includes("@")) || process.env.PREVIEW_TO;
if (override && override.toLowerCase().trim() !== RECIPIENT) {
  console.error(`refused: previews go only to ${RECIPIENT}`);
  process.exit(1);
}

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.replace(/^﻿/, "").match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}

// .env.local carries no NEXT_PUBLIC_SITE_ORIGIN, so CANONICAL_ORIGIN would
// fall back to the old vercel.app host; render the links production sends.
// (The first preview run, 01.10.2026, went out with the vercel.app links.)
process.env.NEXT_PUBLIC_SITE_ORIGIN ||= "https://friendlyinvoice.co.il";

const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error("GMAIL_USER / GMAIL_APP_PASSWORD missing from .env.local");
  process.exit(1);
}

const tpl = await import("../src/app/api/cron/activation-nudge/template.ts");
const { activationOptoutToken } = await import("../src/lib/activation-nudge.ts");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

const optoutUrl = tpl.activationOptoutUrl(DUMMY_USER_ID, activationOptoutToken(DUMMY_USER_ID));
const info = await transporter.sendMail({
  from: `"חשבונית ידידותית" <${GMAIL_USER}>`,
  to: RECIPIENT,
  subject: `[תצוגה מקדימה 3] ${tpl.activationSubject()}`,
  html: tpl.buildActivationHtml(optoutUrl),
  text: tpl.buildActivationText(optoutUrl),
});
if (info.rejected?.length) {
  console.error("preview rejected");
  process.exit(1);
}
console.log(`accepted messageId=${info.messageId} response=${info.response}`);
