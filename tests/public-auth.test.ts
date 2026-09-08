import { afterEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { createPublicAuthStore, schedulePublicAuth, SIGNED_OUT_SNAPSHOT } from "../src/lib/public-auth-store";
const user = { id: "verified-user" } as User;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function setup() {
  let event: (name: string) => void = () => {};
  const unsubscribe = vi.fn();
  const getUser = vi.fn().mockResolvedValue({ data: { user } });
  const load = vi.fn().mockResolvedValue({ getUser, onAuthStateChange: (callback: typeof event) => {
    event = callback; callback("INITIAL_SESSION"); return { data: { subscription: { unsubscribe } } };
  }});
  const cancel = vi.fn();
  let start = () => {};
  const schedule = vi.fn((callback: () => void) => { start = callback; return cancel; });
  const store = createPublicAuthStore(load, schedule);
  return { store, load, getUser, unsubscribe, schedule, cancel, start: () => start(), event: (name: string) => event(name) };
}
describe("shared public auth", () => {
  it("defers and deduplicates loading, verification and subscriptions across consumers", async () => {
    const h = setup(); const off1 = h.store.subscribe(vi.fn()); const off2 = h.store.subscribe(vi.fn());
    expect(h.store.getSnapshot()).toBe(SIGNED_OUT_SNAPSHOT);
    expect(h.schedule).toHaveBeenCalledTimes(1); expect(h.load).not.toHaveBeenCalled();
    h.start(); await flush();
    expect(h.load).toHaveBeenCalledTimes(1); expect(h.getUser).toHaveBeenCalledTimes(1);
    expect(h.store.getSnapshot()).toEqual({ user, checked: true });
    off1(); expect(h.unsubscribe).not.toHaveBeenCalled(); off2(); expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(h.store.getSnapshot()).toBe(SIGNED_OUT_SNAPSHOT);
  });
  it("does not publish a late read after sign-out", async () => {
    const h = setup(); let resolve!: (value: unknown) => void;
    h.getUser.mockImplementation(() => new Promise(r => { resolve = r; }));
    const off = h.store.subscribe(vi.fn()); h.start(); await flush(); h.event("SIGNED_OUT");
    resolve({ data: { user } }); await flush(); expect(h.store.getSnapshot()).toEqual({ user: null, checked: true }); off();
  });
  it("revalidates auth events without trusting their local session", async () => {
    const h = setup(); h.getUser.mockResolvedValue({ data: { user: null } });
    const off = h.store.subscribe(vi.fn()); h.start(); await flush();
    h.getUser.mockResolvedValue({ data: { user } }); h.event("SIGNED_IN");
    expect(h.store.getSnapshot().user).toBeNull(); await flush(); expect(h.store.getSnapshot().user).toBe(user);
    expect(h.getUser).toHaveBeenCalledTimes(2); off();
  });
  it("ignores queued sign-in verification after a newer sign-out", async () => {
    const h = setup(); const off = h.store.subscribe(vi.fn()); h.start(); await flush();
    h.event("SIGNED_IN"); h.event("SIGNED_OUT"); await flush();
    expect(h.getUser).toHaveBeenCalledTimes(1); expect(h.store.getSnapshot().user).toBeNull(); off();
  });
  it("cancels a pending schedule and ignores an import resolving after unmount", async () => {
    const h = setup(); let resolve!: (value: unknown) => void;
    h.load.mockImplementation(() => new Promise(r => { resolve = r; }));
    const off = h.store.subscribe(vi.fn()); h.start(); off(); resolve({ getUser: h.getUser }); await flush();
    expect(h.cancel).toHaveBeenCalled(); expect(h.getUser).not.toHaveBeenCalled();
    expect(h.store.getSnapshot()).toBe(SIGNED_OUT_SNAPSHOT);
  });
  it("rechecks an auth event arriving during an older verification", async () => {
    const h = setup(); let resolve!: (value: unknown) => void;
    h.getUser.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const off = h.store.subscribe(vi.fn()); h.start(); await flush();
    h.event("TOKEN_REFRESHED"); await flush();
    expect(h.getUser).toHaveBeenCalledTimes(1);
    resolve({ data: { user: { id: "stale-user" } } }); await flush();
    expect(h.getUser).toHaveBeenCalledTimes(2);
    expect(h.store.getSnapshot().user).toBe(user); off();
  });
  it("falls back signed-out on verification rejection", async () => {
    const h = setup(); h.getUser.mockRejectedValue(new Error("offline")); const off = h.store.subscribe(vi.fn());
    h.start(); await flush(); expect(h.store.getSnapshot()).toEqual({ user: null, checked: true }); off();
  });
});

describe("public auth scheduling", () => {
  const originalWindow = globalThis.window;
  afterEach(() => { vi.useRealTimers(); vi.stubGlobal("window", originalWindow); });
  function browser(hint: string | null = null) {
    const target = new EventTarget();
    const win = Object.assign(target, { localStorage: { getItem: vi.fn().mockReturnValue(hint) } });
    vi.stubGlobal("window", win); return win;
  }
  it("loads immediately for a stored hint or denied storage", () => {
    const win = browser("untrusted-hint"); const start = vi.fn(); schedulePublicAuth(start); expect(start).toHaveBeenCalledTimes(1);
    win.localStorage.getItem.mockImplementation(() => { throw new Error("denied"); });
    schedulePublicAuth(start); expect(start).toHaveBeenCalledTimes(2);
  });
  it("runs once on first interaction and removes deferred listeners/timer", () => {
    vi.useFakeTimers(); const win = browser(); const start = vi.fn(); schedulePublicAuth(start);
    expect(start).not.toHaveBeenCalled(); win.dispatchEvent(new Event("pointerdown")); win.dispatchEvent(new Event("keydown"));
    vi.runAllTimers(); expect(start).toHaveBeenCalledTimes(1);
  });
  it("uses an idle callback with timeout and cancels it on cleanup", () => {
    const win = Object.assign(browser(), { requestIdleCallback: vi.fn().mockReturnValue(7), cancelIdleCallback: vi.fn() });
    const start = vi.fn(); const cancel = schedulePublicAuth(start);
    expect(win.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 2500 });
    cancel(); expect(win.cancelIdleCallback).toHaveBeenCalledWith(7);
    win.requestIdleCallback.mock.calls[0][0](); expect(start).not.toHaveBeenCalled();
  });
  it("starts for cross-tab session changes or the bounded timer", () => {
    vi.useFakeTimers(); const win = browser(); const start = vi.fn(); schedulePublicAuth(start);
    const change = Object.assign(new Event("storage"), { key: "sb-test-auth-token" }); win.dispatchEvent(change);
    expect(start).toHaveBeenCalledTimes(1);
    const second = vi.fn(); schedulePublicAuth(second); vi.advanceTimersByTime(2500); expect(second).toHaveBeenCalledTimes(1);
  });
});
