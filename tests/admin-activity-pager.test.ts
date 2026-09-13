import { describe, it, expect, vi } from "vitest";
import { createActivityPager, type ActivityPagerState } from "@/lib/admin-activity-pager";
const event = (id: string) => ({ id, kind: "client.created" as const, at: "2026-01-01T00:00:00Z", email: null, businessName: null });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
describe("activity pager", () => {
  it("appends pages without duplicates, blocks parallel loads, stops at end", async () => {
    let state!: ActivityPagerState;
    const next = deferred<{ events: ReturnType<typeof event>[]; nextCursor: null }>();
    const fetchPage = vi.fn().mockResolvedValueOnce({ events: [event("a")], nextCursor: "cursor" }).mockReturnValueOnce(next.promise);
    const pager = createActivityPager(fetchPage, s => { state = s; });
    await pager.refresh(); const pending = pager.loadMore(); await pager.loadMore();
    expect(fetchPage).toHaveBeenCalledTimes(2); expect(state.loading).toBe(true);
    next.resolve({ events: [event("a"), event("b")], nextCursor: null }); await pending;
    expect(state.events.map(e => e.id)).toEqual(["a", "b"]);
    await pager.loadMore(); expect(fetchPage).toHaveBeenCalledTimes(2);
  });
  it("retries the same cursor after failure, keeping existing items", async () => {
    let state!: ActivityPagerState;
    const fetchPage = vi.fn().mockResolvedValueOnce({ events: [event("a")], nextCursor: "cursor" }).mockRejectedValueOnce(new Error()).mockResolvedValueOnce({ events: [event("b")], nextCursor: null });
    const pager = createActivityPager(fetchPage, s => { state = s; });
    await pager.refresh(); await pager.loadMore(); expect(state.error).toBeTruthy(); expect(state.events).toHaveLength(1);
    await pager.retry(); expect(fetchPage.mock.calls[2][0]).toBe("cursor"); expect(state.error).toBeNull(); expect(state.events).toHaveLength(2);
  });
  it("refresh aborts old request and ignores its later result", async () => {
    let state!: ActivityPagerState;
    const old = deferred<{ events: ReturnType<typeof event>[]; nextCursor: null }>();
    const fetchPage = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({ events: [event("fresh")], nextCursor: null });
    const pager = createActivityPager(fetchPage, s => { state = s; });
    const pending = pager.refresh(); await pager.refresh();
    expect(fetchPage.mock.calls[0][1].aborted).toBe(true);
    old.resolve({ events: [event("stale")], nextCursor: null }); await pending;
    expect(state.events.map(e => e.id)).toEqual(["fresh"]);
  });
  it("retries first-page failure and ignores results after disposal", async () => {
    let state!: ActivityPagerState;
    const next = deferred<{ events: ReturnType<typeof event>[]; nextCursor: null }>();
    const fetchPage = vi.fn().mockRejectedValueOnce(new Error()).mockReturnValueOnce(next.promise);
    const pager = createActivityPager(fetchPage, s => { state = s; });
    await pager.refresh(); expect(state.error).toBeTruthy();
    const pending = pager.retry(); pager.dispose(); next.resolve({ events: [event("stale")], nextCursor: null }); await pending;
    expect(fetchPage.mock.calls[1][0]).toBeNull(); expect(state.events).toEqual([]);
  });
});
