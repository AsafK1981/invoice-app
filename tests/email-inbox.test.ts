import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  attachmentMediaType,
  findGmailConfirmUrl,
  generateInboxToken,
  inboxAddressFor,
  inboxTokenFromEvent,
  isGmailConfirmUrl,
  isGmailForwardingConfirmation,
  matchListedAttachment,
  parseInboxToken,
  supportedAttachments,
  svixHeadersFrom,
  verifyResendWebhook,
  MAX_ATTACHMENTS_PER_MAIL,
} from "@/lib/email-inbox";

// The webhook secret is base64 after the whsec_ prefix, exactly as Resend
// shows it in the dashboard.
const SECRET_BYTES = Buffer.from("inbound-webhook-test-secret-key!!");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;

const NOW = Date.parse("2026-09-06T12:00:00Z");
const TS = String(Math.floor(NOW / 1000));
const MSG_ID = "msg_2abc";

function sign(body: string, id = MSG_ID, timestamp = TS, secret = SECRET_BYTES): string {
  return createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`).digest("base64");
}

function headers(over: Partial<{ id: string; timestamp: string; signature: string }> = {}) {
  return {
    id: over.id ?? MSG_ID,
    timestamp: over.timestamp ?? TS,
    signature: over.signature ?? "",
  };
}

describe("verifyResendWebhook", () => {
  const body = JSON.stringify({ type: "email.received", data: { email_id: "e_1" } });

  it("accepts a correctly signed body", () => {
    const v = verifyResendWebhook(
      body,
      headers({ signature: `v1,${sign(body)}` }),
      SECRET,
      NOW,
    );
    expect(v.ok).toBe(true);
  });

  it("accepts when one of several v1 entries matches (secret rotation)", () => {
    const other = createHmac("sha256", Buffer.from("some-other-secret"))
      .update(`${MSG_ID}.${TS}.${body}`)
      .digest("base64");
    const v = verifyResendWebhook(
      body,
      headers({ signature: `v1,${other} v1,${sign(body)}` }),
      SECRET,
      NOW,
    );
    expect(v.ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = `v1,${sign(body)}`;
    const tampered = body.replace("e_1", "e_2");
    const v = verifyResendWebhook(tampered, headers({ signature }), SECRET, NOW);
    expect(v).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects a signature computed over a different svix id", () => {
    const v = verifyResendWebhook(
      body,
      headers({ id: "msg_other", signature: `v1,${sign(body)}` }),
      SECRET,
      NOW,
    );
    expect(v).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects a stale timestamp even when the signature is valid", () => {
    const oldTs = String(Math.floor(NOW / 1000) - 6 * 60);
    const v = verifyResendWebhook(
      body,
      headers({ timestamp: oldTs, signature: `v1,${sign(body, MSG_ID, oldTs)}` }),
      SECRET,
      NOW,
    );
    expect(v).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects a future timestamp outside tolerance", () => {
    const futureTs = String(Math.floor(NOW / 1000) + 6 * 60);
    const v = verifyResendWebhook(
      body,
      headers({ timestamp: futureTs, signature: `v1,${sign(body, MSG_ID, futureTs)}` }),
      SECRET,
      NOW,
    );
    expect(v).toEqual({ ok: false, reason: "stale" });
  });

  it("fails closed when no secret is configured", () => {
    const v = verifyResendWebhook(body, headers({ signature: `v1,${sign(body)}` }), undefined, NOW);
    expect(v).toEqual({ ok: false, reason: "no_secret" });
  });

  it("rejects when the svix headers are missing", () => {
    const v = verifyResendWebhook(body, { id: null, timestamp: null, signature: null }, SECRET, NOW);
    expect(v).toEqual({ ok: false, reason: "missing_headers" });
  });

  it("rejects an unsigned v0 entry", () => {
    const v = verifyResendWebhook(body, headers({ signature: `v0,${sign(body)}` }), SECRET, NOW);
    expect(v).toEqual({ ok: false, reason: "mismatch" });
  });

  it("reads both svix-* and webhook-* header aliases", () => {
    const svix = svixHeadersFrom(
      new Headers({ "svix-id": "a", "svix-timestamp": "1", "svix-signature": "v1,x" }),
    );
    expect(svix).toEqual({ id: "a", timestamp: "1", signature: "v1,x" });

    const standard = svixHeadersFrom(
      new Headers({ "webhook-id": "b", "webhook-timestamp": "2", "webhook-signature": "v1,y" }),
    );
    expect(standard).toEqual({ id: "b", timestamp: "2", signature: "v1,y" });
  });
});

describe("parseInboxToken", () => {
  const previous = process.env.EMAIL_INBOX_DOMAIN;

  beforeEach(() => {
    process.env.EMAIL_INBOX_DOMAIN = "friendlyinvoice.co.il";
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.EMAIL_INBOX_DOMAIN;
    else process.env.EMAIL_INBOX_DOMAIN = previous;
  });

  it("picks the recipient on our domain from `to`", () => {
    expect(parseInboxToken([["k7f3x2ab9m@friendlyinvoice.co.il"], [], []])).toBe("k7f3x2ab9m");
  });

  it("ignores other domains and finds ours further down the list", () => {
    expect(
      parseInboxToken([["someone@gmail.com", "billing@example.com", "abcde12345@friendlyinvoice.co.il"]]),
    ).toBe("abcde12345");
  });

  it("takes the lists in the order given, first match wins", () => {
    expect(parseInboxToken([["a@gmail.com"], ["ccdefgh234@friendlyinvoice.co.il"]])).toBe("ccdefgh234");
    expect(parseInboxToken([["a@gmail.com"], [], ["rfabcde234@friendlyinvoice.co.il"]])).toBe("rfabcde234");
  });

  it("is case-insensitive on both the local part and the domain", () => {
    expect(parseInboxToken([["K7F3X2AB9M@FriendlyInvoice.CO.IL"]])).toBe("k7f3x2ab9m");
  });

  it("unwraps a display-name address", () => {
    expect(parseInboxToken([['"My Invoices" <k7f3x2ab9m@friendlyinvoice.co.il>']])).toBe("k7f3x2ab9m");
  });

  it("strips a +tag suffix", () => {
    expect(parseInboxToken([["k7f3x2ab9m+receipts@friendlyinvoice.co.il"]])).toBe("k7f3x2ab9m");
  });

  it("accepts a bare string instead of an array", () => {
    expect(parseInboxToken(["k7f3x2ab9m@friendlyinvoice.co.il"])).toBe("k7f3x2ab9m");
  });

  it("does not match a lookalike domain", () => {
    expect(parseInboxToken([["token@notfriendlyinvoice.co.il"]])).toBeNull();
    expect(parseInboxToken([["token@friendlyinvoice.co.il.evil.com"]])).toBeNull();
  });

  it("returns null when no recipient is on our domain", () => {
    expect(parseInboxToken([["a@gmail.com"], ["b@outlook.com"], null, undefined])).toBeNull();
    expect(parseInboxToken([])).toBeNull();
  });

  it("honours EMAIL_INBOX_DOMAIN", () => {
    process.env.EMAIL_INBOX_DOMAIN = "in.example.com";
    expect(parseInboxToken([["zz9y8x7w6v@in.example.com"]])).toBe("zz9y8x7w6v");
    expect(parseInboxToken([["zz9y8x7w6v@friendlyinvoice.co.il"]])).toBeNull();
  });
});

describe("inboxTokenFromEvent", () => {
  const previous = process.env.EMAIL_INBOX_DOMAIN;

  beforeEach(() => {
    process.env.EMAIL_INBOX_DOMAIN = "friendlyinvoice.co.il";
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.EMAIL_INBOX_DOMAIN;
    else process.env.EMAIL_INBOX_DOMAIN = previous;
  });

  it("prefers the envelope recipient over the header recipients", () => {
    // received_for is where the mail was actually DELIVERED; To/Cc are text
    // the sender wrote. If they disagree, the envelope decides which business
    // gets charged for the scan.
    expect(
      inboxTokenFromEvent({
        received_for: ["envelope234@friendlyinvoice.co.il"],
        to: ["header7890x@friendlyinvoice.co.il"],
        cc: ["ccccc2345x@friendlyinvoice.co.il"],
      }),
    ).toBe("envelope234");
  });

  it("falls back to `to` and then `cc` when there is no envelope recipient", () => {
    expect(
      inboxTokenFromEvent({ to: ["header7890x@friendlyinvoice.co.il"], cc: ["ccccc2345x@friendlyinvoice.co.il"] }),
    ).toBe("header7890x");
    expect(inboxTokenFromEvent({ cc: ["ccccc2345x@friendlyinvoice.co.il"] })).toBe("ccccc2345x");
  });

  it("is null for a mail that never named an address of ours", () => {
    expect(inboxTokenFromEvent({ to: ["someone@gmail.com"] })).toBeNull();
    expect(inboxTokenFromEvent({})).toBeNull();
  });
});

describe("generateInboxToken", () => {
  it("makes 10 unambiguous lowercase characters", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateInboxToken()).toMatch(/^[a-hjkmnp-z2-9]{10}$/);
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateInboxToken()));
    expect(seen.size).toBe(200);
  });

  it("builds the address on the configured domain", () => {
    const previous = process.env.EMAIL_INBOX_DOMAIN;
    process.env.EMAIL_INBOX_DOMAIN = "in.example.com";
    expect(inboxAddressFor("abcde12345")).toBe("abcde12345@in.example.com");
    if (previous === undefined) delete process.env.EMAIL_INBOX_DOMAIN;
    else process.env.EMAIL_INBOX_DOMAIN = previous;
  });
});

describe("attachmentMediaType", () => {
  it("maps the supported content types", () => {
    expect(attachmentMediaType({ content_type: "application/pdf" })).toBe("application/pdf");
    expect(attachmentMediaType({ content_type: "IMAGE/JPG" })).toBe("image/jpeg");
    expect(attachmentMediaType({ content_type: "image/png; name=a.png" })).toBe("image/png");
    expect(attachmentMediaType({ content_type: "image/webp" })).toBe("image/webp");
  });

  it("falls back to the extension only for a generic content type", () => {
    expect(attachmentMediaType({ content_type: "application/octet-stream", filename: "receipt.PDF" }))
      .toBe("application/pdf");
    expect(attachmentMediaType({ filename: "photo.jpeg" })).toBe("image/jpeg");
    expect(attachmentMediaType({ content_type: "text/calendar", filename: "invite.pdf" })).toBeNull();
  });

  it("rejects everything else instead of guessing image/jpeg", () => {
    expect(attachmentMediaType({ content_type: "application/pgp-signature", filename: "signature.asc" })).toBeNull();
    expect(attachmentMediaType({ content_type: "text/html", filename: "body.html" })).toBeNull();
    expect(attachmentMediaType({ content_type: "image/heic", filename: "IMG_1.heic" })).toBeNull();
    expect(attachmentMediaType({})).toBeNull();
  });
});

describe("supportedAttachments", () => {
  it("keeps every scannable attachment, in the order Resend listed them", () => {
    const picked = supportedAttachments([
      { id: "1", filename: "notes.txt", content_type: "text/plain", content_disposition: "attachment" },
      { id: "2", filename: "a.jpg", content_type: "image/jpeg", content_disposition: "attachment" },
      { id: "3", filename: "b.pdf", content_type: "application/pdf", content_disposition: "attachment" },
    ]);
    expect(picked.map((p) => p.att.id)).toEqual(["2", "3"]);
    expect(picked.map((p) => p.mediaType)).toEqual(["image/jpeg", "application/pdf"]);
  });

  it("numbers them 0..n-1, which is what makes the index stable across redeliveries", () => {
    const payload = [
      { id: "a", filename: "1.pdf", content_type: "application/pdf" },
      { id: "b", filename: "logo.png", content_type: "image/png", content_disposition: "attachment" },
      { id: "c", filename: "2.pdf", content_type: "application/pdf" },
    ];
    expect(supportedAttachments(payload).map((p) => p.index)).toEqual([0, 1, 2]);
    // Same payload, same numbering. A retry must not renumber anything.
    expect(supportedAttachments(payload).map((p) => [p.att.id, p.index])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  it("drops inline parts when there is a real attachment to scan", () => {
    const picked = supportedAttachments([
      { id: "1", filename: "logo.png", content_type: "image/png", content_disposition: "inline" },
      { id: "2", filename: "invoice.pdf", content_type: "application/pdf", content_disposition: "attachment" },
    ]);
    expect(picked.map((p) => p.att.id)).toEqual(["2"]);
    expect(picked[0].index).toBe(0);
  });

  it("falls back to the inline parts when there is nothing else", () => {
    const picked = supportedAttachments([
      { id: "1", filename: "signature.asc", content_type: "application/pgp-signature" },
      { id: "2", filename: "receipt.png", content_type: "image/png", content_disposition: "inline" },
    ]);
    expect(picked.map((p) => p.att.id)).toEqual(["2"]);
    expect(picked[0].mediaType).toBe("image/png");
  });

  it("returns nothing when nothing is scannable", () => {
    expect(supportedAttachments([])).toEqual([]);
    expect(supportedAttachments(undefined)).toEqual([]);
    expect(supportedAttachments([{ id: "1", filename: "invite.ics", content_type: "text/calendar" }])).toEqual([]);
  });

  it("hands the caller everything, so the 5-per-mail cap is the caller's cut", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      id: String(i),
      filename: `receipt-${i}.pdf`,
      content_type: "application/pdf",
      content_disposition: "attachment",
    }));
    const picked = supportedAttachments(many);
    expect(picked).toHaveLength(7);
    expect(MAX_ATTACHMENTS_PER_MAIL).toBe(5);
    // The first five are scanned; the sixth index is the row that carries the
    // "too_many" notice, and everything past it is not recorded at all.
    expect(picked.slice(0, MAX_ATTACHMENTS_PER_MAIL).map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
    expect(picked[MAX_ATTACHMENTS_PER_MAIL].index).toBe(5);
  });
});

describe("matchListedAttachment", () => {
  const wanted = { id: "att_1", filename: "invoice.pdf", content_type: "application/pdf" };

  it("matches on id first", () => {
    const found = matchListedAttachment(
      [
        { id: "att_0", filename: "invoice.pdf", content_type: "application/pdf", download_url: "https://x/0" },
        { id: "att_1", filename: "other.pdf", content_type: "application/pdf", download_url: "https://x/1" },
      ],
      wanted,
      "application/pdf",
    );
    expect(found?.download_url).toBe("https://x/1");
  });

  it("matches on filename only when the media type agrees", () => {
    const listing = [
      { id: "z", filename: "invoice.pdf", content_type: "image/png", download_url: "https://x/png" },
      { id: "y", filename: "invoice.pdf", content_type: "application/pdf", download_url: "https://x/pdf" },
    ];
    expect(matchListedAttachment(listing, { filename: "invoice.pdf" }, "application/pdf")?.download_url)
      .toBe("https://x/pdf");
  });

  it("falls back to a lone entry of the same media type", () => {
    const found = matchListedAttachment(
      [
        { filename: "logo.png", content_type: "image/png", download_url: "https://x/png" },
        { filename: "scan.pdf", content_type: "application/pdf", download_url: "https://x/pdf" },
      ],
      {},
      "application/pdf",
    );
    expect(found?.download_url).toBe("https://x/pdf");
  });

  it("refuses to guess between two entries of the same media type", () => {
    // Handing the same bytes to two different items is worse than failing:
    // download_failed is retryable, a wrong receipt in the books is not.
    expect(
      matchListedAttachment(
        [
          { content_type: "application/pdf", download_url: "https://x/a" },
          { content_type: "application/pdf", download_url: "https://x/b" },
        ],
        {},
        "application/pdf",
      ),
    ).toBeNull();
  });

  it("never falls back to an entry of a different media type", () => {
    expect(
      matchListedAttachment(
        [{ filename: "photo.jpg", content_type: "image/jpeg", download_url: "https://x/jpg" }],
        { filename: "invoice.pdf" },
        "application/pdf",
      ),
    ).toBeNull();
    expect(matchListedAttachment([], wanted, "application/pdf")).toBeNull();
  });
});

describe("gmail forwarding confirmation", () => {
  it("recognises the real sender regardless of case or display name", () => {
    expect(isGmailForwardingConfirmation("forwarding-noreply@google.com")).toBe(true);
    expect(isGmailForwardingConfirmation("Gmail Team <Forwarding-Noreply@Google.com>")).toBe(true);
  });

  it("rejects a spoofed display name that only CONTAINS the real address", () => {
    // The whole point of the exact match: the display name is attacker-chosen
    // text, and treating it as the sender would hand a stranger the "confirm
    // the forwarding" button inside the owner's app.
    expect(isGmailForwardingConfirmation('"forwarding-noreply@google.com" <attacker@evil.com>')).toBe(false);
    expect(isGmailForwardingConfirmation("forwarding-noreply@google.com.evil.com")).toBe(false);
    expect(isGmailForwardingConfirmation("evil+forwarding-noreply@google.com@evil.com")).toBe(false);
    expect(isGmailForwardingConfirmation("noreply@google.com")).toBe(false);
    expect(isGmailForwardingConfirmation(null)).toBe(false);
  });

  it("accepts both hosts Gmail has used", () => {
    expect(isGmailConfirmUrl("https://mail-settings.google.com/mail/vf-%5BANGjdJ8%5D-abc")).toBe(true);
    expect(isGmailConfirmUrl("https://mail-settings.google.com/anything?x=1")).toBe(true);
    expect(isGmailConfirmUrl("https://mail.google.com/mail/vf-abc?x=1")).toBe(true);
  });

  it("rejects every host that merely looks Google-ish", () => {
    expect(isGmailConfirmUrl("https://www.google.com/mail/vf-abc")).toBe(false);
    expect(isGmailConfirmUrl("https://mail.google.com.evil.com/mail/vf-abc")).toBe(false);
    expect(isGmailConfirmUrl("https://mail.google.com@evil.com/mail/vf-abc")).toBe(false);
    expect(isGmailConfirmUrl("https://evil.com/?next=https://mail.google.com/mail/vf-abc")).toBe(false);
    // Right host, wrong path: mail.google.com is the whole webmail app.
    expect(isGmailConfirmUrl("https://mail.google.com/mail/u/0/#inbox")).toBe(false);
    // http is not https, javascript: is not a URL we ever render.
    expect(isGmailConfirmUrl("http://mail-settings.google.com/mail/vf-abc")).toBe(false);
    expect(isGmailConfirmUrl("javascript:alert(1)")).toBe(false);
    expect(isGmailConfirmUrl("")).toBe(false);
    expect(isGmailConfirmUrl(null)).toBe(false);
  });

  it("pulls the confirmation link out of the body", () => {
    const text = "To allow forwarding, click:\nhttps://mail-settings.google.com/mail/vf-%5BANGjdJ8%5D-abc\nThanks.";
    expect(findGmailConfirmUrl(text)).toBe("https://mail-settings.google.com/mail/vf-%5BANGjdJ8%5D-abc");
  });

  it("un-escapes &amp; from the html part and ignores unrelated links", () => {
    const html =
      '<a href="https://support.google.com">help</a><a href="https://mail.google.com/mail/vf-abc?x=1&amp;y=2">confirm</a>';
    expect(findGmailConfirmUrl(null, html)).toBe("https://mail.google.com/mail/vf-abc?x=1&y=2");
  });

  it("skips a spoofed link and keeps looking for the real one", () => {
    const html =
      '<a href="https://mail.google.com.evil.com/mail/vf-1">confirm</a>' +
      '<a href="https://mail-settings.google.com/mail/vf-real">confirm</a>';
    expect(findGmailConfirmUrl(html)).toBe("https://mail-settings.google.com/mail/vf-real");
  });

  it("returns null when there is no confirmation link", () => {
    expect(findGmailConfirmUrl("nothing here", "<p>nor here</p>")).toBeNull();
    expect(findGmailConfirmUrl("see https://evil.com/mail/vf-abc")).toBeNull();
    expect(findGmailConfirmUrl(null, undefined)).toBeNull();
  });
});

describe("the email source_ref contract", () => {
  // source_ref is composed inside email_inbox_approve() (the insert has to be
  // in the same transaction as the item lock), so the shape lives in SQL and
  // this is what holds it there. Change the format and the partial unique
  // index stops recognising receipts already in the books.
  const sql = readFileSync(
    new URL("../scripts/migrations/20260906-email-inbox.sql", import.meta.url),
    "utf8",
  );

  it("is <message id>#<attachment index>", () => {
    expect(sql).toContain("v_item.message_id || '#' || v_item.attachment_index");
    // What that produces for the second attachment of one forwarded mail:
    const messageId = "<CAF=abc@mail.gmail.com>";
    expect(`${messageId}#${1}`).toBe("<CAF=abc@mail.gmail.com>#1");
  });

  it("is deduped by the partial unique index rather than by a pre-read", () => {
    expect(sql).toContain("ON CONFLICT (business_id, source_ref) WHERE source_ref IS NOT NULL DO NOTHING");
    expect(sql).toContain("UNIQUE (business_id, message_id, attachment_index)");
  });

  it("keeps the SECURITY DEFINER function off every public role", () => {
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(sql).toContain(
        `REVOKE EXECUTE ON FUNCTION public.email_inbox_approve(uuid, uuid, jsonb) FROM ${role};`,
      );
    }
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.email_inbox_approve(uuid, uuid, jsonb) TO service_role;",
    );
  });
});
