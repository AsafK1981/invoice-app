import { describe, it, expect } from "vitest";
import {
  NUDGE_META,
  activationOptoutToken,
  selectActivationNudges,
  verifyActivationOptoutToken,
  type NudgeBusiness,
  type NudgeUser,
} from "../src/lib/activation-nudge";
import {
  activationOptoutUrl,
  activationSubject,
  buildActivationHtml,
  buildActivationText,
} from "../src/app/api/cron/activation-nudge/template";
import { CANONICAL_ORIGIN } from "../src/lib/public-url";

const NOW = new Date("2026-10-01T07:00:00Z");
const H = 60 * 60 * 1000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * H).toISOString();

let seq = 0;
function user(hoursOld: number, extra: Partial<NudgeUser> = {}): NudgeUser {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    email: `u${seq}@example.com`,
    created_at: ago(hoursOld),
    email_confirmed_at: ago(hoursOld),
    app_metadata: {},
    ...extra,
  };
}
function biz(u: NudgeUser, id = `b0000000-0000-4000-8000-${u.id.slice(-12)}`): NudgeBusiness {
  return { id, user_id: u.id };
}

function run(users: NudgeUser[], businesses: NudgeBusiness[] = [], withDocs: string[] = []) {
  return selectActivationNudges({
    users,
    businesses,
    businessIdsWithDocs: new Set(withDocs),
    now: NOW,
  });
}

describe("activation nudge selection", () => {
  it("only inside the 24h-72h window", () => {
    const tooYoung = user(23);
    const due = user(30);
    const tooOld = user(80);
    const out = run([tooYoung, due, tooOld]);
    expect(out).toEqual([{ userId: due.id, email: due.email }]);
  });

  it("one email per user, ever: anyone already marked is never re-sent", () => {
    const sent = user(30, { app_metadata: { [NUDGE_META.sent]: ago(5) } });
    const legacyBoth = user(60, {
      app_metadata: { activation_nudge_d1_at: ago(40), activation_nudge_d2_at: ago(2) },
    });
    expect(run([sent, legacyBoth])).toEqual([]);
    expect(NUDGE_META.sent).toBe("activation_nudge_d1_at");
    const fresh = user(30);
    expect(run([fresh, fresh])).toHaveLength(1);
  });

  it("skips anyone whose business has any document", () => {
    const u = user(30);
    const b = biz(u);
    expect(run([u], [b], [b.id])).toEqual([]);
    expect(run([u], [b], [])).toHaveLength(1);
  });

  it("checks documents across every business the user holds", () => {
    const u = user(30);
    const b1 = biz(u, "c0000000-0000-4000-8000-000000000001");
    const b2 = biz(u, "c0000000-0000-4000-8000-000000000002");
    expect(run([u], [b1, b2], [b2.id])).toEqual([]);
  });

  it("skips opted-out users", () => {
    const u = user(30, { app_metadata: { [NUDGE_META.optout]: ago(1) } });
    const u2 = user(40, { app_metadata: { [NUDGE_META.optout]: ago(1) } });
    expect(run([u, u2])).toEqual([]);
  });

  it("excludes internal accounts, the admin and .internal logins", () => {
    const internalBiz = user(30);
    const admin = user(30, { email: "asafkotlar@gmail.com" });
    const bot = user(30, { email: "qa-bot@lynkeus.internal" });
    const mixed = user(30); // holds one internal business and one of their own
    const out = run(
      [internalBiz, admin, bot, mixed],
      [
        biz(internalBiz, "dc3b5b61-0000-4000-8000-000000000000"),
        biz(mixed, "3085885f-0000-4000-8000-000000000000"),
        biz(mixed, "d0000000-0000-4000-8000-000000000009"),
      ],
    );
    expect(out).toEqual([]);
  });

  it("skips unconfirmed, emailless and banned users", () => {
    const unconfirmed = user(30, { email_confirmed_at: null });
    const noEmail = user(30, { email: "" });
    const banned = user(30, { banned_until: new Date(NOW.getTime() + 1000 * H).toISOString() });
    expect(run([unconfirmed, noEmail, banned])).toEqual([]);
  });

  it("includes a user who never created a business", () => {
    const u = user(30);
    expect(run([u], [])).toEqual([{ userId: u.id, email: u.email }]);
  });
});

describe("activation opt-out token", () => {
  const secret = "test-secret";
  const id = "11111111-2222-4333-8444-555555555555";

  it("round-trips and rejects tampering", () => {
    const t = activationOptoutToken(id, secret);
    expect(t).toHaveLength(32);
    expect(verifyActivationOptoutToken(id, t, secret)).toBe(true);
    expect(verifyActivationOptoutToken("11111111-2222-4333-8444-555555555556", t, secret)).toBe(false);
    expect(verifyActivationOptoutToken(id, t, "other-secret")).toBe(false);
    expect(verifyActivationOptoutToken(id, "", secret)).toBe(false);
  });
});

const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

const BANNED_DURATION_WORDS = ["לתמיד", "לנצח", "ללא הגבלת זמן", "קבוע", "forever", "permanent"];

describe("activation email template", () => {
  const optout = activationOptoutUrl("11111111-2222-4333-8444-555555555555", "x".repeat(32));
  const html = buildActivationHtml(optout);
  const text = buildActivationText(optout);
  const subject = activationSubject();

  it("subject, preheader, video card, FAQ and the single-campaign links", () => {
    expect(subject).toBe("18 שניות, ואתם יודעים בדיוק איך זה עובד");
    expect(html).toMatch(/<html[^>]*lang="he"[^>]*dir="rtl"/);
    expect(html).toContain("צילמתי חשבונית ראשונה מההתחלה ועד הסוף.");
    expect(html).toContain('style="display:none;max-height:0;overflow:hidden;opacity:0;"');
    expect(html).toContain(
      `href="${CANONICAL_ORIGIN}/video?utm_source=email&utm_medium=lifecycle&utm_campaign=activation"`,
    );
    expect(html).toContain(
      `href="${CANONICAL_ORIGIN}/documents/new?utm_source=email&utm_medium=lifecycle&utm_campaign=activation"`,
    );
    expect(html + text).not.toMatch(/activation_d\d/);
    expect(html).toContain(`src="${CANONICAL_ORIGIN}/email/video-thumb.jpg"`);
    expect(html).toContain(`src="${CANONICAL_ORIGIN}/email/asaf-240.jpg"`);
    expect(html).toContain(`src="${CANONICAL_ORIGIN}/logo-192.png"`);
    expect(html).toContain("בניתי את חשבונית ידידותית");
    expect(html).toContain("ושלוש השאלות שהכי שואלים אותי:");
    expect(html).toContain(`href="${optout}"`);
    expect(html).toContain("לא רוצה לקבל תזכורות כאלה");
    expect(text).toContain("להוציא חשבונית ראשונה: ");
    expect(text).toContain(optout);
  });

  it("pricing answer is exactly the approved copy, in HTML and text", () => {
    const pricing =
      "עד 5 מסמכים בחודש זה חינם, בלי כרטיס אשראי. צריכים יותר? 15 ₪ לחודש, או 25 ₪ בלי הגבלה. ובתקופת ההשקה הכול פתוח בלי הגבלה.";
    expect(html).toContain(pricing);
    expect(text).toContain(pricing);
  });

  it("never promises a duration on the free tier (legal review ban)", () => {
    const all = (html + text + subject).toLowerCase();
    for (const word of BANNED_DURATION_WORDS) expect(all).not.toContain(word.toLowerCase());
  });

  it("no long dashes, no phone or email address, no <style>", () => {
    const all = html + text + subject;
    expect(all).not.toMatch(LONG_DASH);
    expect(all).not.toContain("asafkotlar");
    expect(all).not.toMatch(/mailto:|tel:|05\d-?\d{3}-?\d{4}/);
    expect(all).not.toContain("<style");
  });
});
