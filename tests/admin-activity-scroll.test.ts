import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { INITIAL_ACTIVITY_STATE } from "@/lib/admin-activity-pager";
const state = vi.hoisted(() => ({ index: 0, refs: [] as any[] }));
vi.mock("react", async () => ({ ...await vi.importActual<typeof import("react")>("react"), useRef: () => ({ current: state.refs[state.index++] }), useEffect: (fn: () => void) => fn() }));
import { ActivityFeed } from "@/components/admin-activity-feed";
beforeEach(() => { state.index = 0; state.refs = [{ scrollHeight: 900, scrollTop: 0, clientHeight: 500 }, {}]; vi.stubGlobal("React", React); });
describe("activity scroll container", () => {
  it("automatically observes within the feed and requests more near its scroll end", () => {
    const load = vi.fn(); let callback!: (entries: { isIntersecting: boolean }[]) => void; let root: unknown;
    vi.stubGlobal("IntersectionObserver", class { constructor(cb: typeof callback, options: { root: unknown }) { callback = cb; root = options.root; } observe() {} disconnect() {} });
    const tree = ActivityFeed({ state: { ...INITIAL_ACTIVITY_STATE, initialized: true, nextCursor: "next" }, onLoadMore: load, onRetry: vi.fn() });
    expect(root).toBe(state.refs[0]); callback([{ isIntersecting: true }]); expect(load).toHaveBeenCalledTimes(1);
    tree.props.onScroll({ currentTarget: { scrollHeight: 900, scrollTop: 0, clientHeight: 500 } }); expect(load).toHaveBeenCalledTimes(1);
    tree.props.onScroll({ currentTarget: { scrollHeight: 900, scrollTop: 380, clientHeight: 500 } }); expect(load).toHaveBeenCalledTimes(2);
    expect(tree.props.tabIndex).toBe(0);
  });
  it.each([{ loading: true }, { error: "failed" }, { nextCursor: null }])("does not automatically fetch while blocked or complete: %o", patch => {
    const load = vi.fn(); const observer = vi.fn(); vi.stubGlobal("IntersectionObserver", observer);
    const tree = ActivityFeed({ state: { ...INITIAL_ACTIVITY_STATE, initialized: true, nextCursor: "next", ...patch }, onLoadMore: load, onRetry: vi.fn() });
    tree.props.onScroll({ currentTarget: { scrollHeight: 500, scrollTop: 0, clientHeight: 500 } }); expect(load).not.toHaveBeenCalled(); expect(observer).not.toHaveBeenCalled();
  });
});
