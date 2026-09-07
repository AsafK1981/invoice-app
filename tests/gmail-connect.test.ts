import { describe, it, expect } from "vitest";
import {
  buildGmailQuery,
  buildGoogleAuthUrl,
  daysAgoIso,
  emailFromIdToken,
  gmailMessageIdentity,
  pickGmailAttachments,
  signOAuthState,
  verifyOAuthState,
  type GmailPart,
} from "@/lib/gmail-connect";
import { isAllowedRequestHost, requestOrigin } from "@/lib/request-origin";
import { CANONICAL_HOST, CANONICAL_ORIGIN } from "@/lib/public-url";

const SECRET = "test-column-key-0123456789abcdef";

describe("OAuth state", () => {
  const payload = { businessId: "b-1", userId: "u-1", exp: Date.now() + 60_000 };

  it("round-trips a signed payload", () => {
    const state = signOAuthState(payload, SECRET);
    expect(verifyOAuthState(state, SECRET)).toEqual(payload);
  });

  it("rejects a tampered body even with the original signature", () => {
    const state = signOAuthState(payload, SECRET);
    const [body, mac] = state.split(".");
    const other = Buffer.from(JSON.stringify({ ...payload, businessId: "b-2" })).toString("base64url");
    expect(other).not.toBe(body);
    expect(verifyOAuthState(`${other}.${mac}`, SECRET)).toBeNull();
  });

  it("rejects a state signed with a different key", () => {
    const state = signOAuthState(payload, "another-key");
    expect(verifyOAuthState(state, SECRET)).toBeNull();
  });

  it("rejects an expired state and accepts a live one at the same instant", () => {
    const state = signOAuthState(payload, SECRET);
    expect(verifyOAuthState(state, SECRET, payload.exp + 1)).toBeNull();
    expect(verifyOAuthState(state, SECRET, payload.exp - 1)).not.toBeNull();
  });

  it("never throws on garbage", () => {
    expect(verifyOAuthState("", SECRET)).toBeNull();
    expect(verifyOAuthState("no-dot", SECRET)).toBeNull();
    expect(verifyOAuthState("a.", SECRET)).toBeNull();
    expect(verifyOAuthState(".b", SECRET)).toBeNull();
    expect(verifyOAuthState("%%%.%%%", SECRET)).toBeNull();
    expect(verifyOAuthState(signOAuthState(payload, SECRET), "")).toBeNull();
  });

  it("refuses to sign without a secret", () => {
    expect(() => signOAuthState(payload, "")).toThrow();
  });
});

describe("buildGoogleAuthUrl", () => {
  it("asks for offline access with consent, the readonly scope, and carries the state", () => {
    const u = new URL(buildGoogleAuthUrl("https://friendlyinvoice.co.il/api/gmail/callback", "abc.def")); // domain-literal-ok: exercises the exact redirect_uri registered with Google
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("scope")).toContain("gmail.readonly");
    expect(u.searchParams.get("redirect_uri")).toBe("https://friendlyinvoice.co.il/api/gmail/callback"); // domain-literal-ok: must match the line above verbatim
    expect(u.searchParams.get("state")).toBe("abc.def");
    expect(u.searchParams.get("client_id")).toMatch(/apps\.googleusercontent\.com$/);
  });
});

describe("buildGmailQuery", () => {
  it("looks for attachments with invoice words, skipping chats, own mail and our inbox domain", () => {
    const q = buildGmailQuery({ after: "2026-01-01", before: "2026-09-07", domain: "friendlyinvoice.co.il" }); // domain-literal-ok: exercises a real inbox domain, not a self-origin default
    expect(q).toContain("has:attachment");
    expect(q).toContain("(חשבונית OR קבלה OR invoice OR receipt)");
    expect(q).toContain("-in:chats");
    expect(q).toContain("-from:me");
    expect(q).toContain("-to:friendlyinvoice.co.il"); // domain-literal-ok: matches the domain passed in above
    expect(q).toContain("after:2026/01/01");
    expect(q).toContain("before:2026/09/07");
  });

  it("omits the date bounds when none are given", () => {
    const q = buildGmailQuery({ domain: "x.test" });
    expect(q).not.toContain("after:");
    expect(q).not.toContain("before:");
  });
});

describe("emailFromIdToken", () => {
  const token = (claims: Record<string, unknown>) =>
    `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

  it("reads and normalises the e-mail claim", () => {
    expect(emailFromIdToken(token({ email: " Asaf@Example.com " }))).toBe("asaf@example.com");
  });

  it("is null without an e-mail or on a malformed token", () => {
    expect(emailFromIdToken(token({ sub: "123" }))).toBeNull();
    expect(emailFromIdToken("not-a-jwt")).toBeNull();
    expect(emailFromIdToken(null)).toBeNull();
  });
});

describe("pickGmailAttachments", () => {
  const part = (over: Partial<GmailPart>): GmailPart => ({ mimeType: "application/pdf", ...over });

  const payload: GmailPart = {
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "multipart/related",
        parts: [
          { mimeType: "text/html", body: { size: 1200 } },
          // Signature logo: inline, has a Content-ID. Must not cost a scan.
          part({
            mimeType: "image/png",
            filename: "logo.png",
            headers: [{ name: "Content-ID", value: "<logo@x>" }, { name: "Content-Disposition", value: "inline" }],
            body: { attachmentId: "att-logo", size: 3000 },
          }),
        ],
      },
      part({ filename: "invoice-4471.pdf", body: { attachmentId: "att-pdf", size: 48000 } }),
      // A spreadsheet is not scannable.
      part({
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename: "data.xlsx",
        body: { attachmentId: "att-xlsx", size: 9000 },
      }),
      part({ mimeType: "image/jpeg", filename: "receipt.jpg", body: { attachmentId: "att-jpg", size: 120000 } }),
    ],
  };

  it("keeps real PDF and image attachments, in order, and skips inline and unsupported parts", () => {
    const picks = pickGmailAttachments(payload);
    expect(picks.map((p) => p.attachmentId)).toEqual(["att-pdf", "att-jpg"]);
    expect(picks.map((p) => p.index)).toEqual([0, 1]);
    expect(picks[0].mediaType).toBe("application/pdf");
    expect(picks[1].mediaType).toBe("image/jpeg");
  });

  it("caps at the per-mail ceiling", () => {
    const many: GmailPart = {
      mimeType: "multipart/mixed",
      parts: Array.from({ length: 9 }, (_, i) =>
        part({ filename: `f${i}.pdf`, body: { attachmentId: `a${i}`, size: 100 } }),
      ),
    };
    expect(pickGmailAttachments(many)).toHaveLength(5);
  });

  it("is empty for a message without a payload or without files", () => {
    expect(pickGmailAttachments(undefined)).toEqual([]);
    expect(pickGmailAttachments({ mimeType: "text/plain", body: { size: 10 } })).toEqual([]);
  });
});

describe("gmailMessageIdentity", () => {
  it("prefixes the message id, reads From and Subject, and converts internalDate", () => {
    const id = gmailMessageIdentity("biz-1", {
      id: "18f0abc",
      internalDate: "1788700839000",
      payload: {
        headers: [
          { name: "From", value: "Cloud Israel <billing@cloud.example>" },
          { name: "Subject", value: "חשבונית מס 4471" },
        ],
      },
    });
    expect(id.message_id).toBe("gmail:18f0abc");
    expect(id.email_id).toBe("18f0abc");
    expect(id.from_address).toBe("Cloud Israel <billing@cloud.example>");
    expect(id.subject).toBe("חשבונית מס 4471");
    expect(id.received_at).toBe("2026-09-06T13:20:39.000Z");
    expect(id.origin).toBe("gmail");
  });

  it("falls back to now when internalDate is missing", () => {
    const before = Date.now();
    const id = gmailMessageIdentity("biz-1", { id: "x" });
    expect(new Date(id.received_at).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});

describe("daysAgoIso", () => {
  it("returns a plain date n days back", () => {
    expect(daysAgoIso(2, new Date("2026-09-07T10:00:00Z"))).toBe("2026-09-05");
  });
});

describe("requestOrigin host allowlist", () => {
  const req = (headers: Record<string, string>) =>
    new Request("https://internal.invalid/api/gmail/connect", { headers });

  it("accepts the hosts the app is served on", () => {
    expect(isAllowedRequestHost(CANONICAL_HOST)).toBe(true);
    expect(isAllowedRequestHost(`www.${CANONICAL_HOST}`)).toBe(true);
    expect(isAllowedRequestHost("mysuperfriendlyinvoiceapp.vercel.app")).toBe(true); // domain-literal-ok: the old host stays attached on purpose, see AGENTS.md
    expect(isAllowedRequestHost("mysuperfriendlyinvoiceapp-kl3visnlk-asafk1981s-projects.vercel.app")).toBe(true); // domain-literal-ok: a real preview host shape
    expect(isAllowedRequestHost("localhost:3000")).toBe(true);
  });

  it("refuses anything else, including look-alikes", () => {
    expect(isAllowedRequestHost("evil.com")).toBe(false);
    expect(isAllowedRequestHost(`${CANONICAL_HOST}.evil.com`)).toBe(false);
    expect(isAllowedRequestHost("mysuperfriendlyinvoiceapp-x-someone-else.vercel.app")).toBe(false); // domain-literal-ok: a look-alike preview host, must stay refused
  });

  it("uses x-forwarded-host when allowed and falls back to the canonical origin when not", () => {
    expect(requestOrigin(req({ "x-forwarded-host": CANONICAL_HOST, host: "internal" }))).toBe(CANONICAL_ORIGIN);
    expect(requestOrigin(req({ "x-forwarded-host": "evil.com" }))).toMatch(/^https:\/\//);
    expect(requestOrigin(req({ "x-forwarded-host": "evil.com" }))).not.toContain("evil.com");
    expect(requestOrigin(req({ host: "localhost:3000" }))).toBe("http://localhost:3000"); // domain-literal-ok: exercises the local dev fallback, not a self-origin default
  });
});
