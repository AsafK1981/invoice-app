import { describe, it, expect } from "vitest";
import { isDeadEndReply, splitReplyLinks } from "@/lib/assistant-reply";

/**
 * REGRESSION GUARD for the assistant's "no dead ends" rule (Asaf, 2026-08-25:
 * the assistant must never answer "I can't help"). The route re-asks the model
 * when a reply matches; the widget turns literal routes into links so the
 * next step it names is one click away.
 */

describe("isDeadEndReply", () => {
  it("catches the refusals users actually saw", () => {
    for (const t of [
      "מצטער, אני לא יכול לעזור עם ייבוא מאפליקציה אחרת.",
      "אין לי אפשרות לייבא נתונים מתוכנה אחרת.",
      "לא בטוח איך עושים את זה באפליקציה.",
      "אינני יכול לבצע את הפעולה הזו.",
      "אין לי תשובה לשאלה הזו.",
      "התכונה הזו לא קיימת באפליקציה.",
      "זה מחוץ לתחום היכולות שלי.",
      "אין לי מידע על זה.",
      "I can't help with that.",
    ]) {
      expect(isDeadEndReply(t), t).toBe(true);
    }
  });

  it("lets honest results and referrals through", () => {
    for (const t of [
      "לא נמצאו מסמכים התואמים לחיפוש.",
      "לא נמצאו לקוחות בשם דני.",
      "לשאלה על חובת דיווח כדאי לפנות לרואה חשבון.",
      "מצאתי 5 מסמכים מהחודש האחרון, סה\"כ 4,680 ₪.",
      "הייבוא נעשה במסך /migrate: בחר את התוכנה שממנה אתה מגיע ועקוב אחרי השלבים.",
      "הטיוטה מוכנה, פתח אותה בעורך ואשר.",
      "",
    ]) {
      expect(isDeadEndReply(t), t).toBe(false);
    }
  });
});

describe("splitReplyLinks", () => {
  it("turns a bare internal route into a link and leaves dates alone", () => {
    const segs = splitReplyLinks("היכנס ל-/migrate ובחר תוכנה. הופק ב-12/03/2026.");
    expect(segs).toEqual([
      { kind: "text", text: "היכנס ל-" },
      { kind: "link", text: "/migrate", href: "/migrate", external: false },
      { kind: "text", text: " ובחר תוכנה. הופק ב-12/03/2026." },
    ]);
  });

  it("links a full https URL, without the trailing punctuation", () => {
    const segs = splitReplyLinks("שלח ל-https://wa.me/972549000684?text=hi.");
    expect(segs[1]).toEqual({
      kind: "link",
      text: "https://wa.me/972549000684?text=hi",
      href: "https://wa.me/972549000684?text=hi",
      external: true,
    });
    expect(segs[2]).toEqual({ kind: "text", text: "." });
  });

  it("keeps settings anchors and nested report routes whole", () => {
    expect(splitReplyLinks("/settings#tax-authority").map((s) => s.kind)).toEqual(["link"]);
    expect(splitReplyLinks("ב-/reports/vat יש את הדוח").find((s) => s.kind === "link")).toMatchObject({
      href: "/reports/vat",
    });
  });

  it("links the document-design tab, which lives outside /settings", () => {
    const segs = splitReplyLinks("את הגופן משנים במסך /design (לשונית עיצוב מסמך).");
    expect(segs.filter((s) => s.kind === "link")).toEqual([
      { kind: "link", text: "/design", href: "/design", external: false },
    ]);
  });

  it("does not link a path glued to a word or a URL twice", () => {
    const segs = splitReplyLinks("friendlyinvoice.co.il/migrate");
    expect(segs.every((s) => s.kind === "text")).toBe(true);
    const url = splitReplyLinks("https://friendlyinvoice.co.il/migrate");
    expect(url.filter((s) => s.kind === "link")).toHaveLength(1);
  });

  it("returns plain text untouched", () => {
    expect(splitReplyLinks("שלום")).toEqual([{ kind: "text", text: "שלום" }]);
  });
});
