import { describe, it, expect, vi, afterEach } from "vitest";
import {
  deliverPush,
  parsePushSubscription,
  resetVapidForTests,
  sendPushForNotification,
  PUSH_FALLBACK_URL,
  type PushDeps,
  type PushSubscriptionRow,
} from "@/lib/push-server";

/**
 * The sender is the one piece of the push feature that can hurt: it runs
 * inside every notification producer, it talks to third-party push services,
 * and it holds capability URLs. So the four behaviours pinned here are the
 * four ways it could misbehave in production:
 *
 *   - pushing a kind the owner never opted in to,
 *   - keeping a dead subscription alive forever,
 *   - sending a device somewhere off-site,
 *   - throwing into a producer when the keys are not deployed.
 */

type Sent = { endpoint: string; payload: string };

function deps(
  overrides: {
    kinds?: string[] | null;
    subs?: PushSubscriptionRow[];
    send?: (sub: PushSubscriptionRow, payload: string) => Promise<void>;
  } = {},
) {
  const sent: Sent[] = [];
  const deletedIds: string[] = [];
  const usedIds: string[] = [];

  const impl: PushDeps = {
    loadKinds: async () => (overrides.kinds === undefined ? ["invoice_viewed"] : overrides.kinds),
    loadSubscriptions: async () =>
      overrides.subs ?? [{ id: "sub-1", endpoint: "https://push.example/1", p256dh: "k", auth: "a" }],
    send: async (sub, payload) => {
      if (overrides.send) return overrides.send(sub, payload);
      sent.push({ endpoint: sub.endpoint, payload });
    },
    deleteSubscription: async (id) => {
      deletedIds.push(id);
    },
    markUsed: async (id) => {
      usedIds.push(id);
    },
  };

  return { impl, sent, deletedIds, usedIds };
}

const BASE = {
  businessId: "biz-1",
  kind: "invoice_viewed" as const,
  title: "הלקוח פתח את החשבונית",
};

afterEach(() => {
  vi.restoreAllMocks();
  resetVapidForTests();
});

describe("deliverPush", () => {
  it("sends nothing when the kind is not in push_kinds", async () => {
    const d = deps({ kinds: ["payment_matched"] });
    const result = await deliverPush(d.impl, BASE);
    expect(result).toEqual({ sent: 0, removed: 0, skipped: true });
    expect(d.sent).toHaveLength(0);
  });

  it("sends nothing when push_kinds could not be read (un-migrated database)", async () => {
    const d = deps({ kinds: null });
    const result = await deliverPush(d.impl, BASE);
    expect(result.skipped).toBe(true);
    expect(d.sent).toHaveLength(0);
  });

  it("sends to every subscription of the business and marks them used", async () => {
    const d = deps({
      subs: [
        { id: "sub-1", endpoint: "https://push.example/1", p256dh: "k", auth: "a" },
        { id: "sub-2", endpoint: "https://push.example/2", p256dh: "k", auth: "a" },
      ],
    });
    const result = await deliverPush(d.impl, { ...BASE, href: "/documents/7" });
    expect(result).toEqual({ sent: 2, removed: 0, skipped: false });
    expect(d.usedIds).toEqual(["sub-1", "sub-2"]);
    expect(JSON.parse(d.sent[0].payload)).toMatchObject({
      title: BASE.title,
      url: "/documents/7",
      kind: "invoice_viewed",
    });
  });

  it("deletes a subscription the push service reports as gone (410) and keeps going", async () => {
    const d = deps({
      subs: [
        { id: "dead", endpoint: "https://push.example/dead", p256dh: "k", auth: "a" },
        { id: "live", endpoint: "https://push.example/live", p256dh: "k", auth: "a" },
      ],
      send: async (sub) => {
        if (sub.id === "dead") {
          throw Object.assign(new Error("Gone"), { statusCode: 410 });
        }
      },
    });
    const result = await deliverPush(d.impl, BASE);
    expect(d.deletedIds).toEqual(["dead"]);
    expect(result).toEqual({ sent: 1, removed: 1, skipped: false });
  });

  it("keeps a subscription that failed transiently (500)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = deps({
      send: async () => {
        throw Object.assign(new Error("Service Unavailable"), { statusCode: 503 });
      },
    });
    const result = await deliverPush(d.impl, BASE);
    expect(d.deletedIds).toEqual([]);
    expect(result).toEqual({ sent: 0, removed: 0, skipped: false });
  });

  it("falls back to /notifications for an off-site or malformed href", async () => {
    for (const href of ["https://evil.example/steal", "//evil.example", "javascript:alert(1)"]) {
      const d = deps();
      await deliverPush(d.impl, { ...BASE, href });
      expect(JSON.parse(d.sent[0].payload).url).toBe(PUSH_FALLBACK_URL);
    }
  });

  it("bypasses push_kinds only when explicitly asked (the test button)", async () => {
    const d = deps({ kinds: [] });
    const result = await deliverPush(
      d.impl,
      { ...BASE, kind: "test" as never },
      { matchKinds: false },
    );
    expect(result.sent).toBe(1);
  });
});

describe("sendPushForNotification without VAPID keys", () => {
  it("is a silent no-op instead of throwing into the producer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const previous = {
      pub: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      priv: process.env.VAPID_PRIVATE_KEY,
      subject: process.env.VAPID_SUBJECT,
    };
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    resetVapidForTests();

    try {
      const result = await sendPushForNotification(BASE);
      expect(result).toEqual({ sent: 0, removed: 0, skipped: true });
      expect(warn).toHaveBeenCalled();
      // Logged once per process, not once per notification.
      await sendPushForNotification(BASE);
      expect(warn.mock.calls.filter((c) => String(c[0]).includes("VAPID"))).toHaveLength(1);
    } finally {
      if (previous.pub) process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = previous.pub;
      if (previous.priv) process.env.VAPID_PRIVATE_KEY = previous.priv;
      if (previous.subject) process.env.VAPID_SUBJECT = previous.subject;
      resetVapidForTests();
    }
  });
});

describe("parsePushSubscription", () => {
  const keys = { p256dh: "BNc-key_value", auth: "auth-secret_1" };

  it("accepts what a browser actually produces", () => {
    const r = parsePushSubscription({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys,
      userAgent: "Mozilla/5.0",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.endpoint).toBe("https://fcm.googleapis.com/fcm/send/abc123");
      expect(r.value.userAgent).toBe("Mozilla/5.0");
    }
  });

  it("rejects a non-https endpoint", () => {
    for (const endpoint of ["http://push.example/x", "file:///etc/passwd", "not-a-url"]) {
      expect(parsePushSubscription({ endpoint, keys }).ok).toBe(false);
    }
  });

  it("rejects an oversize endpoint or key", () => {
    expect(
      parsePushSubscription({ endpoint: `https://push.example/${"x".repeat(1100)}`, keys }).ok,
    ).toBe(false);
    expect(
      parsePushSubscription({
        endpoint: "https://push.example/x",
        keys: { p256dh: "x".repeat(600), auth: "a" },
      }).ok,
    ).toBe(false);
  });

  it("accepts a key with base64 padding, which some browsers include", () => {
    const r = parsePushSubscription({
      endpoint: "https://push.example/x",
      keys: { p256dh: "BNc-key_value=", auth: "auth==" },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects keys that are not base64url", () => {
    expect(
      parsePushSubscription({
        endpoint: "https://push.example/x",
        keys: { p256dh: "has spaces", auth: "ok" },
      }).ok,
    ).toBe(false);
    expect(parsePushSubscription({ endpoint: "https://push.example/x" }).ok).toBe(false);
  });

  it("truncates an over-long user agent instead of rejecting the device", () => {
    const r = parsePushSubscription({
      endpoint: "https://push.example/x",
      keys,
      userAgent: "u".repeat(1000),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.userAgent).toHaveLength(256);
  });

  it("rejects a body that is not an object", () => {
    expect(parsePushSubscription(null).ok).toBe(false);
    expect(parsePushSubscription("endpoint").ok).toBe(false);
  });
});
