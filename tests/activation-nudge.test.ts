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
  it("email #1 only inside the 24h-72h window", () => {
    const tooYoung = user(23);
    const d1 = user(30);
    const tooOld = user(80);
    const out = run([tooYoung, d1, tooOld]);
    expect(out).toEqual([{ userId: d1.id, email: d1.email, step: 1 }]);
  });

  it("email #2 from 72h, only after #1 was sent, and not right after it", () => {
    const due = user(80, { app_metadata: { [NUDGE_META.d1]: ago(50) } });
    const tooSoonAfterD1 = user(80, { app_metadata: { [NUDGE_META.d1]: ago(10) } });
    const notYet72 = user(60, { app_metadata: { [NUDGE_META.d1]: ago(40) } });
    const out = run([due, tooSoonAfterD1, notYet72]);
    expect(out).toEqual([{ userId: due.id, email: due.email, step: 2 }]);
  });

  it("never more than two emails, never both in one run", () => {
    const done = user(200, { app_metadata: { [NUDGE_META.d1]: ago(150), [NUDGE_META.d2]: ago(100) } });
    const out = run([done]);
    expect(out).toEqual([]);
    const fresh = user(30);
    expect(run([fresh]).filter((c) => c.userId === fresh.id)).toHaveLength(1);
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
    const u2 = user(80, { app_metadata: { [NUDGE_META.d1]: ago(50), [NUDGE_META.optout]: ago(1) } });
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
    expect(run([u], [])).toEqual([{ userId: u.id, email: u.email, step: 1 }]);
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

describe("activation email templates", () => {
  const optout = activationOptoutUrl("11111111-2222-4333-8444-555555555555", "x".repeat(32));

  it("email #1: copy, deep link with d1 utm, opt-out", () => {
    const html = buildActivationHtml(1, optout);
    expect(activationSubject(1)).toBe("החשבונית הראשונה שלך מחכה");
    expect(html).toMatch(/<html[^>]*lang="he"[^>]*dir="rtl"/);
    expect(html).toContain(
      `href="${CANONICAL_ORIGIN}/documents/new?utm_source=email&utm_medium=lifecycle&utm_campaign=activation_d1"`,
    );
    expect(html).toContain("להוציא חשבונית עכשיו");
    expect(html).toContain(`href="${optout}"`);
    expect(html).toContain("לא רוצה לקבל תזכורות כאלה");
    expect(html).toContain("צוות חשבונית ידידותית");
  });

  it("email #2: video CTA plus the d3 deep link", () => {
    const html = buildActivationHtml(2, optout);
    expect(activationSubject(2)).toBe("20 שניות, וזה מוכן");
    expect(html).toContain(
      `href="${CANONICAL_ORIGIN}/video?utm_source=email&utm_medium=lifecycle&utm_campaign=activation_d3"`,
    );
    expect(html).toContain(
      `href="${CANONICAL_ORIGIN}/documents/new?utm_source=email&utm_medium=lifecycle&utm_campaign=activation_d3"`,
    );
    expect(html).toContain("או להוציא חשבונית ראשונה עכשיו");
  });

  it("no long dashes, no personal name or address, no <style>", () => {
    for (const step of [1, 2] as const) {
      const all = buildActivationHtml(step, optout) + buildActivationText(step, optout) + activationSubject(step);
      expect(all).not.toMatch(LONG_DASH);
      expect(all).not.toContain("אסף");
      expect(all).not.toContain("asafkotlar");
      expect(all).not.toContain("<style");
    }
  });
});
