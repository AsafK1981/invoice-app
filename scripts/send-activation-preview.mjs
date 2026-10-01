// One-off preview of the two activation emails, sent ONLY to the owner.
//
//   npx tsx scripts/send-activation-preview.mjs
//
// Renders both templates (src/app/api/cron/activation-nudge/template.ts) for a
// dummy user id and sends them through the same Gmail SMTP relay and FROM
// line the app uses, with the subject prefixed "[תצוגה מקדימה] ". The
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
for (const step of [1, 2]) {
  const info = await transporter.sendMail({
    from: `"חשבונית ידידותית" <${GMAIL_USER}>`,
    to: RECIPIENT,
    subject: `[תצוגה מקדימה] ${tpl.activationSubject(step)}`,
    html: tpl.buildActivationHtml(step, optoutUrl),
    text: tpl.buildActivationText(step, optoutUrl),
  });
  if (info.rejected?.length) {
    console.error(`email ${step} rejected`);
    process.exit(1);
  }
  console.log(`email ${step}: accepted messageId=${info.messageId} response=${info.response}`);
}
