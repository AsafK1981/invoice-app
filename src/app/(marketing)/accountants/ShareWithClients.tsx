"use client";

import { useState } from "react";
import { Check, Copy, Mail, MessageCircle } from "lucide-react";

/**
 * "Send to your clients" block on /accountants (Asaf, 2026-09-27): a ready
 * message plus link the accountant forwards from their own phone or mail.
 * The share buttons open the accountant's own WhatsApp / mail client with
 * the text filled in - nothing is sent by us, and this is not the app's
 * (not yet live) WhatsApp channel.
 *
 * utm_source=accountant lets Vercel Analytics count signups that came
 * through an accountant.
 */

const LINK = "https://friendlyinvoice.co.il/?utm_source=accountant";

const MESSAGE =
  "היי, כדי שיהיה לך פשוט להוציא קבלות וחשבוניות כמו שצריך, אני ממליץ על האפליקציה הזו. " +
  "היא חינמית, בלי כרטיס אשראי, מוציאה מספרי הקצאה אוטומטית ושומרת הכול מסודר בשבילי בסוף השנה:\n" +
  LINK;

const WHATSAPP_HREF = `https://wa.me/?text=${encodeURIComponent(MESSAGE)}`;
const MAIL_HREF = `mailto:?subject=${encodeURIComponent(
  "תוכנת חשבוניות שאני ממליץ עליה",
)}&body=${encodeURIComponent(MESSAGE)}`;

export default function ShareWithClients() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(MESSAGE);
    } catch {
      // Older browsers / blocked clipboard: select the text so Ctrl+C works.
      const el = document.getElementById("acc-share-text");
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  }

  return (
    <div className="acc-share-card">
      <div className="acc-share-head">
        <h2 id="acc-share-title">שלחו ללקוחות שלכם</h2>
        <p>הודעה מוכנה עם הקישור. מעתיקים ושולחים, ללקוח אחד או לכולם.</p>
      </div>

      <p className="acc-share-text" id="acc-share-text" dir="rtl">
        {MESSAGE.split("\n")[0]}
        <br />
        <span dir="ltr" className="acc-share-link">
          {LINK}
        </span>
      </p>

      <div className="acc-share-actions">
        <button type="button" className="ml-btn ml-btn-primary ml-btn-sm" onClick={copy}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "הועתק" : "העתקת ההודעה"}
        </button>
        <a
          className="ml-btn ml-btn-outline ml-btn-sm"
          href={WHATSAPP_HREF}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MessageCircle aria-hidden="true" />
          שליחה בוואטסאפ
        </a>
        <a className="ml-btn ml-btn-outline ml-btn-sm" href={MAIL_HREF}>
          <Mail aria-hidden="true" />
          שליחה במייל
        </a>
      </div>
      <span className="acc-share-live" aria-live="polite">
        {copied ? "ההודעה הועתקה" : ""}
      </span>
    </div>
  );
}
