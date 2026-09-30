"use client";

import { useState } from "react";
import { Check } from "lucide-react";

/**
 * "Join the directory" form on /accountants (Asaf, 2026-09-30).
 *
 * The first ten accountants are listed right away as founding partners; the
 * form is how an accountant says yes without a call or an email thread. What
 * they type is exactly what gets published, and the checkbox is the written
 * consent the listing rules require (src/lib/partner-accountants.ts).
 *
 * `foundingLeft` comes from the page: ten minus the founding partners already
 * LISTED in code. It is deliberately not a live count of submissions, so a
 * bot filling the form cannot make the offer look sold out. Listing, and who
 * is a founding partner, are reviewed steps on our side, so the success line
 * promises an answer within one business day and nothing about a slot.
 */
type State = { kind: "idle" } | { kind: "sending" } | { kind: "done" } | { kind: "error"; message: string };

export default function JoinDirectory({ foundingLeft }: { foundingLeft: number }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const field = (k: string) => String(data.get(k) ?? "");
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/partner-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: field("name"),
          office: field("office"),
          city: field("city"),
          email: field("email"),
          phone: field("phone"),
          website: field("website"),
          company: field("company"),
          consent: data.get("consent") === "on",
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (json.ok) setState({ kind: "done" });
      else setState({ kind: "error", message: json.error || "לא הצלחנו לשלוח. נסו שוב." });
    } catch {
      setState({ kind: "error", message: "לא הצלחנו לשלוח. בדקו את החיבור ונסו שוב." });
    }
  }

  if (state.kind === "done") {
    return (
      <div className="acc-join-card acc-join-done" role="status">
        <span className="acc-join-done-icon" aria-hidden="true">
          <Check />
        </span>
        <h3>קיבלנו, תודה</h3>
        <p>
          תוך יום עבודה נחזור אליכם במייל עם מקומכם ברשימה שבתוך האפליקציה ועם קישור אישי להעביר ללקוחות.
        </p>
      </div>
    );
  }

  const sending = state.kind === "sending";
  return (
    <form className="acc-join-card" onSubmit={submit}>
      <div className="acc-join-head">
        <h3 id="acc-join-title">להצטרף לרשימה</h3>
        {foundingLeft > 0 ? (
          <span className="acc-join-left">
            נותרו {foundingLeft} מתוך 10 מקומות לשותפים מייסדים
          </span>
        ) : null}
      </div>
      <p className="acc-join-sub">הפרטים שתמלאו כאן הם מה שיופיע ברשימה. מייל, טלפון ואתר: רק מה שתרצו לפרסם.</p>

      <div className="acc-join-grid">
        <label className="acc-join-field">
          <span>שם מלא</span>
          <input name="name" type="text" required minLength={2} maxLength={80} autoComplete="name" />
        </label>
        <label className="acc-join-field">
          <span>שם המשרד (לא חובה)</span>
          <input name="office" type="text" maxLength={100} autoComplete="organization" />
        </label>
        <label className="acc-join-field">
          <span>עיר</span>
          <input name="city" type="text" required minLength={2} maxLength={60} autoComplete="address-level2" />
        </label>
        <label className="acc-join-field">
          <span>מייל</span>
          <input name="email" type="email" required maxLength={160} autoComplete="email" dir="ltr" />
        </label>
        <label className="acc-join-field">
          <span>טלפון (לא חובה)</span>
          <input name="phone" type="tel" maxLength={30} autoComplete="tel" dir="ltr" />
        </label>
        <label className="acc-join-field">
          <span>אתר (לא חובה)</span>
          <input name="website" type="text" maxLength={200} autoComplete="url" dir="ltr" />
        </label>
      </div>

      {/* Honeypot: hidden from people and from assistive tech. */}
      <div className="acc-join-hp" aria-hidden="true">
        <label>
          Company
          <input name="company" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <label className="acc-join-consent">
        <input name="consent" type="checkbox" required />
        <span>אני מאשר/ת לפרסם את הפרטים האלה ברשימת רואי החשבון שבתוך האפליקציה</span>
      </label>

      {state.kind === "error" ? (
        <p className="acc-join-error" role="alert">
          {state.message}
        </p>
      ) : null}

      <button type="submit" className="ml-btn ml-btn-primary ml-btn-lg" disabled={sending}>
        {sending ? "שולח..." : "להצטרף לרשימה"}
      </button>
    </form>
  );
}
