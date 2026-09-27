import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CONSENT_KEY } from "@/lib/analytics-consent";
import {
  _resetGaStateForTests,
  deleteGaCookies,
  gaEvent,
  gaPageView,
  getGtmId,
  loadGtm,
  markSignupSent,
  setGlobalPageFields,
  wasSignupSent,
} from "@/lib/ga";

// Node environment, no jsdom (see vitest.config.ts). A minimal window /
// document is stubbed per test: just enough surface for gaEvent (location,
// dataLayer, localStorage, referrer), loadGtm (querySelector, createElement,
// head) and deleteGaCookies (a recording document.cookie).

const ORIGIN = "https://friendlyinvoice.co.il";

function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

type FakeWindow = {
  localStorage: ReturnType<typeof makeStorage>;
  location: { href: string; origin: string; pathname: string; hostname: string };
  dataLayer?: unknown[];
};

let win: FakeWindow;
let appended: Array<Record<string, unknown>>;
let cookieWrites: string[];

function at(
  pathAndQuery: string,
  {
    consent,
    gtm,
    referrer = "",
    cookies = "",
    title = "כרטסת ישראל ישראלי - העסק שלי",
  }: { consent?: boolean; gtm?: boolean; referrer?: string; cookies?: string; title?: string } = {},
) {
  const url = new URL(ORIGIN + pathAndQuery);
  win = {
    localStorage: makeStorage(),
    location: { href: url.href, origin: url.origin, pathname: url.pathname, hostname: url.hostname },
  };
  if (consent !== undefined) {
    win.localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({ v: 1, analytics: consent, at: new Date().toISOString() }),
    );
  }
  if (gtm) win.dataLayer = [];
  vi.stubGlobal("window", win);
  appended = [];
  cookieWrites = [];
  const doc = {
    // A customer-data title on purpose: it must never reach the dataLayer.
    title,
    referrer,
    querySelector: (sel: string) =>
      appended.find((s) => sel.includes("data-fi-gtm") && s["data-fi-gtm"]) ?? null,
    createElement: () => {
      const el: Record<string, unknown> = {};
      el.setAttribute = (k: string, v: string) => {
        el[k] = v;
      };
      return el;
    },
    head: { appendChild: (el: Record<string, unknown>) => appended.push(el) },
  };
  Object.defineProperty(doc, "cookie", {
    get: () => cookies,
    set: (v: string) => void cookieWrites.push(v),
  });
  vi.stubGlobal("document", doc);
}

/** Entries that are gtag commands (Arguments objects), as plain arrays. */
function gtagCommands(): unknown[][] {
  return (win.dataLayer ?? [])
    .filter((e) => Object.prototype.toString.call(e) === "[object Arguments]")
    .map((e) => Array.from(e as IArguments));
}

beforeEach(() => {
  _resetGaStateForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("gaEvent consent gate", () => {
  it("pushes nothing without a stored choice", () => {
    at("/pricing", { gtm: true });
    gaEvent("sign_up", { method: "email" });
    expect(win.dataLayer).toEqual([]);
  });

  it("pushes nothing after a decline", () => {
    at("/pricing", { consent: false, gtm: true });
    gaEvent("sign_up", { method: "email" });
    expect(win.dataLayer).toEqual([]);
  });

  it("pushes the event with sanitized location, static title and host-only referrer", () => {
    at("/login?next=%2Fdashboard&utm_source=fb", {
      consent: true,
      gtm: true,
      referrer: "https://l.facebook.com/l.php?u=secret",
    });
    gaEvent("sign_up", { method: "email" });
    expect(win.dataLayer).toEqual([
      {
        event: "sign_up",
        method: "email",
        page_location: `${ORIGIN}/login?utm_source=fb`,
        page_title: "/login",
        page_referrer: "https://l.facebook.com/",
      },
    ]);
  });

  it("overrides location, title and referrer on a non-allowlisted (app) path", () => {
    at("/clients/abc/statement", {
      consent: true,
      gtm: true,
      referrer: `${ORIGIN}/view/3f1c2d4e-0000-4000-8000-000000000000`,
    });
    gaEvent("first_document_created", { doc_type: "receipt" });
    expect(win.dataLayer).toEqual([
      {
        event: "first_document_created",
        doc_type: "receipt",
        page_location: `${ORIGIN}/app`,
        page_title: "app",
        page_referrer: "",
      },
    ]);
  });

  it("a caller cannot smuggle real app values in through params", () => {
    at("/documents/1", { consent: true, gtm: true });
    gaEvent("x", {
      page_location: `${ORIGIN}/documents/1`,
      page_title: "client name",
      page_referrer: `${ORIGIN}/view/abc`,
    });
    expect(win.dataLayer![0]).toMatchObject({
      page_location: `${ORIGIN}/app`,
      page_title: "app",
      page_referrer: "",
    });
  });

  it("does nothing on an app route where GTM was never loaded", () => {
    at("/dashboard", { consent: true });
    gaEvent("first_document_created", { doc_type: "receipt" });
    expect(win.dataLayer).toBeUndefined();
    // ...and a later load (were one to happen) has nothing queued to flush.
    at("/pricing", { consent: true });
    loadGtm("GTM-TEST1");
    expect(
      win.dataLayer!.some((e) => (e as { event?: string }).event === "first_document_created"),
    ).toBe(false);
  });

  it("never throws, even with no window at all", () => {
    vi.stubGlobal("window", undefined);
    expect(() => gaEvent("sign_up")).not.toThrow();
  });
});

describe("loadGtm", () => {
  it("consent default all denied, update grants ONLY analytics_storage, then globals, then gtm.js, script once", () => {
    at("/", { consent: true });
    loadGtm("GTM-TEST1");
    loadGtm("GTM-TEST1");

    const cmds = gtagCommands();
    expect(cmds[0]).toEqual([
      "consent",
      "default",
      { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" },
    ]);
    expect(cmds[1]).toEqual([
      "consent",
      "update",
      { ad_storage: "denied", analytics_storage: "granted", ad_user_data: "denied", ad_personalization: "denied" },
    ]);
    expect(cmds[2]).toEqual([
      "set",
      { page_location: `${ORIGIN}/`, page_title: "/", page_referrer: "" },
    ]);
    // gtag commands are Arguments objects, not arrays (GTM ignores arrays).
    expect(Object.prototype.toString.call(win.dataLayer![0])).toBe("[object Arguments]");
    expect(win.dataLayer![3]).toMatchObject({ event: "gtm.js" });
    expect(appended).toHaveLength(1);
    expect(appended[0].src).toBe("https://www.googletagmanager.com/gtm.js?id=GTM-TEST1");
  });

  it("flushes an event fired before the bootstrap, after consent and globals", () => {
    // The /onboarding case: the page's effect runs before the root layout's.
    at("/onboarding", { consent: true });
    gaEvent("sign_up", { method: "onboarding" });
    expect(win.dataLayer).toBeUndefined();
    loadGtm("GTM-TEST1");
    expect(win.dataLayer![4]).toMatchObject({ event: "sign_up", method: "onboarding" });
  });
});

describe("setGlobalPageFields (gtag set on every route)", () => {
  it("points the globals at the anonymous /app on an off-allowlist path", () => {
    at("/clients/abc/statement", {
      gtm: true,
      referrer: `${ORIGIN}/view/3f1c2d4e-0000-4000-8000-000000000000`,
    });
    setGlobalPageFields();
    expect(gtagCommands()).toEqual([
      ["set", { page_location: `${ORIGIN}/app`, page_title: "app", page_referrer: "" }],
    ]);
  });

  it("uses the sanitized location and path title on an allowlisted path", () => {
    at("/product/?email=a%40b.c&utm_medium=cpc", {
      gtm: true,
      referrer: "https://www.google.com/search?q=x",
    });
    setGlobalPageFields();
    expect(gtagCommands()).toEqual([
      [
        "set",
        {
          page_location: `${ORIGIN}/product/?utm_medium=cpc`,
          page_title: "/product",
          page_referrer: "https://www.google.com/",
        },
      ],
    ]);
  });

  it("never creates a dataLayer when GTM did not load", () => {
    at("/dashboard");
    setGlobalPageFields();
    expect(win.dataLayer).toBeUndefined();
  });
});

describe("gaPageView", () => {
  it("sends fi_page_view with a static title on an allowlisted path", () => {
    at("/pricing?utm_source=fb", { consent: true, gtm: true, title: "stale previous title" });
    gaPageView();
    expect(win.dataLayer).toEqual([
      {
        event: "fi_page_view",
        page_path: "/pricing",
        page_title: "/pricing",
        page_location: `${ORIGIN}/pricing?utm_source=fb`,
        page_referrer: "",
      },
    ]);
  });

  it("sends nothing on an app path", () => {
    at("/dashboard", { consent: true, gtm: true });
    gaPageView();
    expect(win.dataLayer).toEqual([]);
  });
});

describe("deleteGaCookies (withdrawal)", () => {
  it("expires _ga and every _ga_* cookie host-only and on each parent domain", () => {
    at("/pricing", { cookies: "_ga=GA1.1.1; sb-auth=keep; _ga_ABC123=GS1.1; _gat=1; x_ga=2" });
    deleteGaCookies();
    for (const name of ["_ga", "_ga_ABC123"]) {
      const writes = cookieWrites.filter((w) => w.startsWith(`${name}=;`));
      expect(writes.every((w) => w.includes("expires=Thu, 01 Jan 1970") && w.includes("path=/"))).toBe(true);
      // host-only + .friendlyinvoice.co.il + .co.il (ignored by browsers)
      expect(writes.some((w) => !w.includes("domain="))).toBe(true);
      expect(writes.some((w) => w.endsWith("domain=.friendlyinvoice.co.il"))).toBe(true);
    }
    // Nothing else is touched: not the auth cookie, not look-alikes.
    expect(cookieWrites.some((w) => /^(sb-auth|_gat|x_ga)=/.test(w))).toBe(false);
  });

  it("writes nothing when there are no GA cookies", () => {
    at("/pricing", { cookies: "sb-auth=keep" });
    deleteGaCookies();
    expect(cookieWrites).toEqual([]);
  });
});

describe("getGtmId", () => {
  it("is null when unset or malformed, so everything stays off", () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", "");
    expect(getGtmId()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", "G-ABC123"); // a GA4 id, not a container
    expect(getGtmId()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", " GTM-ABC123 ");
    expect(getGtmId()).toBe("GTM-ABC123");
  });
});

describe("sign_up de-duplication flag", () => {
  it("is unset on a fresh browser and set after marking", () => {
    at("/onboarding");
    expect(wasSignupSent()).toBe(false);
    markSignupSent();
    expect(wasSignupSent()).toBe(true);
  });
});
