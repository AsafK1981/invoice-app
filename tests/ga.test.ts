import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CONSENT_KEY } from "@/lib/analytics-consent";
import {
  _resetGaStateForTests,
  gaEvent,
  gaPageView,
  getGtmId,
  loadGtm,
  markSignupSent,
  wasSignupSent,
} from "@/lib/ga";

// Node environment, no jsdom (see vitest.config.ts). A minimal window /
// document is stubbed per test: just enough surface for gaEvent (location,
// dataLayer, localStorage) and loadGtm (querySelector, createElement, head).

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
  location: { href: string; origin: string; pathname: string };
  dataLayer?: unknown[];
};

let win: FakeWindow;
let appended: Array<Record<string, unknown>>;

function at(pathAndQuery: string, { consent, gtm }: { consent?: boolean; gtm?: boolean } = {}) {
  const url = new URL(ORIGIN + pathAndQuery);
  win = {
    localStorage: makeStorage(),
    location: { href: url.href, origin: url.origin, pathname: url.pathname },
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
  vi.stubGlobal("document", {
    title: "חשבונית ידידותית",
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
  });
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

  it("pushes the event with a sanitized location once consent is granted", () => {
    at("/login?next=%2Fdashboard&utm_source=fb", { consent: true, gtm: true });
    gaEvent("sign_up", { method: "email" });
    expect(win.dataLayer).toEqual([
      {
        event: "sign_up",
        method: "email",
        page_location: `${ORIGIN}/login?utm_source=fb`,
      },
    ]);
  });

  it("overrides location and title on a non-allowlisted (app) path", () => {
    at("/clients/abc/statement", { consent: true, gtm: true });
    gaEvent("first_document_created", { doc_type: "receipt" });
    expect(win.dataLayer).toEqual([
      {
        event: "first_document_created",
        doc_type: "receipt",
        page_location: `${ORIGIN}/app`,
        page_title: "app",
      },
    ]);
  });

  it("a caller cannot smuggle a real app URL in through params", () => {
    at("/documents/1", { consent: true, gtm: true });
    gaEvent("x", { page_location: `${ORIGIN}/documents/1` });
    expect(win.dataLayer![0]).toMatchObject({ page_location: `${ORIGIN}/app` });
  });

  it("does nothing on an app route where GTM was never loaded", () => {
    at("/dashboard", { consent: true });
    gaEvent("first_document_created", { doc_type: "receipt" });
    expect(win.dataLayer).toBeUndefined();
    // ...and a later load (were one to happen) has nothing queued to flush.
    at("/pricing", { consent: true });
    loadGtm("GTM-TEST1");
    expect(win.dataLayer!.some((e) => (e as { event?: string }).event === "first_document_created")).toBe(false);
  });

  it("never throws, even with no window at all", () => {
    vi.stubGlobal("window", undefined);
    expect(() => gaEvent("sign_up")).not.toThrow();
  });
});

describe("loadGtm", () => {
  it("pushes consent default then update before gtm.js, then injects the script once", () => {
    at("/", { consent: true });
    loadGtm("GTM-TEST1");
    loadGtm("GTM-TEST1");

    const dl = win.dataLayer!;
    // gtag commands are Arguments objects, not arrays (GTM ignores arrays).
    const first = dl[0] as IArguments;
    const second = dl[1] as IArguments;
    expect(Object.prototype.toString.call(first)).toBe("[object Arguments]");
    expect(Array.from(first)).toEqual([
      "consent",
      "default",
      { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" },
    ]);
    expect(Array.from(second)).toEqual([
      "consent",
      "update",
      { ad_storage: "granted", analytics_storage: "granted", ad_user_data: "granted", ad_personalization: "granted" },
    ]);
    expect(dl[2]).toMatchObject({ event: "gtm.js" });
    expect(appended).toHaveLength(1);
    expect(appended[0].src).toBe("https://www.googletagmanager.com/gtm.js?id=GTM-TEST1");
  });

  it("flushes an event fired before the bootstrap, after the consent commands", () => {
    // The /onboarding case: the page's effect runs before the root layout's.
    at("/onboarding", { consent: true });
    gaEvent("sign_up", { method: "onboarding" });
    expect(win.dataLayer).toBeUndefined();
    loadGtm("GTM-TEST1");
    expect(win.dataLayer![3]).toMatchObject({ event: "sign_up", method: "onboarding" });
  });
});

describe("gaPageView", () => {
  it("sends fi_page_view on an allowlisted path", () => {
    at("/pricing?utm_source=fb", { consent: true, gtm: true });
    gaPageView();
    expect(win.dataLayer).toEqual([
      {
        event: "fi_page_view",
        page_path: "/pricing",
        page_title: "חשבונית ידידותית",
        page_location: `${ORIGIN}/pricing?utm_source=fb`,
      },
    ]);
  });

  it("sends nothing on an app path", () => {
    at("/dashboard", { consent: true, gtm: true });
    gaPageView();
    expect(win.dataLayer).toEqual([]);
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
