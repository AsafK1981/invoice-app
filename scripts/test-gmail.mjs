import nodemailer from "nodemailer";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .reduce((acc, line) => {
    const [key, ...rest] = line.split("=");
    if (key) acc[key.trim()] = rest.join("=").trim();
    return acc;
  }, {});

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: env.GMAIL_USER,
    pass: env.GMAIL_APP_PASSWORD,
  },
});

console.log(`Testing Gmail SMTP for ${env.GMAIL_USER}...`);

const info = await transporter.sendMail({
  from: `MySuperFriendlyInvoiceApp <${env.GMAIL_USER}>`,
  to: env.GMAIL_USER,
  subject: "✅ Gmail SMTP test - הכל עובד",
  html: `
    <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px;">
      <h2 style="color: #f97316;">בדיקה הצליחה! 🎉</h2>
      <p>זאת הודעת בדיקה מהאפליקציה שלך. הצלחנו לשלוח אימייל דרך חשבון Gmail שלך.</p>
      <p>מעכשיו, כל החשבוניות והקבלות יישלחו מ-<strong>${env.GMAIL_USER}</strong> ולא מהכתובת של Resend.</p>
    </div>
  `,
});

console.log("✅ Email sent successfully!");
console.log("Message ID:", info.messageId);
console.log("Check your inbox at", env.GMAIL_USER);
