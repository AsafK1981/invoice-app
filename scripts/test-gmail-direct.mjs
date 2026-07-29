import nodemailer from "nodemailer";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n")
  .reduce((a, l) => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) a[m[1]] = m[2];
    return a;
  }, {});

const user = env.GMAIL_USER;
const pass = env.GMAIL_APP_PASSWORD;
console.log("local GMAIL_USER:", user || "(missing)");
console.log("local GMAIL_APP_PASSWORD:", pass ? `<set len=${pass.length}>` : "(missing)");

if (!user || !pass) process.exit(1);

const t = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user, pass: pass.replace(/\s+/g, "") },
});

try {
  const info = await t.sendMail({
    from: `"MyFriendlyInvoiceApp test" <${user}>`,
    to: "asafkotlar@gmail.com",
    subject: "SMTP test from local at " + new Date().toISOString(),
    text: "If you got this, GMAIL_USER and GMAIL_APP_PASSWORD are valid. Check your spam folder if you see it there.",
  });
  console.log("✓ sent:", info.messageId);
} catch (e) {
  console.error("✗ send failed:", e.message);
  process.exit(1);
}
