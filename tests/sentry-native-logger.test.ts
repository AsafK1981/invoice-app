import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { defaultStackParser } from "@sentry/browser";

const { init } = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  init,
  captureMessage: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
}));

const message = "Error invoking postMessage: Java exception was raised during method invocation";
const logger = "app://navigation_performance_logger_android";
let beforeSend: (event: ErrorEvent, hint: EventHint) => unknown;

function exception(value = message, filename = logger) {
  return {
    type: "Error",
    value,
    stacktrace: { frames: [
      { filename, function: "sendBeforeUnloadMessage", lineno: 1, colno: 13750 },
      { filename, function: "sendDataToNative", lineno: 1, colno: 10198 },
    ] },
  };
}

beforeAll(async () => {
  vi.stubGlobal("window", { addEventListener: vi.fn() });
  await import("../instrumentation-client");
  beforeSend = init.mock.calls[0][0].beforeSend;
});

describe("Sentry native navigation logger filtering", () => {
  it.each(["/login", "/product"])("drops the reported logger exception on %s", (transaction) => {
    const event: ErrorEvent = { type: undefined, transaction, exception: { values: [exception()] } };
    expect(beforeSend(event, {})).toBeNull();
  });

  it.each([
    "    at window._handleBrowserPreparingToClose (app://navigation_performance_logger_android:1:15718)\n    at <anonymous>:1:22",
    "    at window._handleNavigationPerformanceLoggerSoftNavigationEvent (app://navigation_performance_logger_android:1:16015)\n    at <anonymous>:1:22",
    "    at app://navigation_performance_logger_android:1:18302\n    at _.ni (app:///gsi/client:164:198)\n    at yv (app:///gsi/client:378:390)",
  ])("filters the real stack variants through the installed SDK parser", (callers) => {
    const frames = defaultStackParser(`Error: ${message}\n    at sendDataToNative (${logger}:1:10198)\n    at sendBeforeUnloadMessage (${logger}:1:13750)\n${callers}`);
    const event: ErrorEvent = { type: undefined, exception: { values: [{ type: "Error", value: message, stacktrace: { frames } }] } };
    expect(beforeSend(event, {})).toBeNull();
  });

  it.each([
    exception(message, "https://friendlyinvoice.co.il/_next/static/app.js"),
    exception("Cannot read properties of undefined"),
    { type: "Error", value: message },
    exception(message, "https://example.com/navigation_performance_logger_android"),
    exception(message, "app://navigation_performance_logger_android_extra"),
  ])("preserves nonmatching or unproven exceptions", (error) => {
    const event: ErrorEvent = { type: undefined, exception: { values: [error] } };
    expect(beforeSend(event, {})).toBe(event);
  });

  it("preserves errors thrown by app code even when a logger is a caller", () => {
    const error = exception();
    error.stacktrace.frames.push({ filename: "https://friendlyinvoice.co.il/_next/static/app.js", function: "save", lineno: 1, colno: 1 });
    const event: ErrorEvent = { type: undefined, exception: { values: [error] } };
    expect(beforeSend(event, {})).toBe(event);
  });

  it("preserves mixed exception chains", () => {
    const event: ErrorEvent = { type: undefined, exception: { values: [exception(), exception("Invoice save failed")] } };
    expect(beforeSend(event, {})).toBe(event);
  });

  it("preserves message events", () => {
    const event: ErrorEvent = { type: undefined, message: "Stale build asset after deploy" };
    expect(beforeSend(event, {})).toBe(event);
  });

  it("retains the existing stale asset rejection filter", () => {
    class Link { href = "https://friendlyinvoice.co.il/_next/static/old.css"; }
    vi.stubGlobal("HTMLLinkElement", Link);
    vi.stubGlobal("HTMLScriptElement", class {});
    const reason = new Event("error");
    Object.defineProperty(reason, "target", { value: new Link() });
    expect(beforeSend({ type: undefined, exception: { values: [exception("Asset failed")] } }, { originalException: reason })).toBeNull();
  });
});
