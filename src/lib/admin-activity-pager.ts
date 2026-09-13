import type { AdminActivityEvent } from "./admin-activity";
export interface ActivityPage { events: AdminActivityEvent[]; nextCursor: string | null }
export interface ActivityPagerState extends ActivityPage { loading: boolean; error: string | null; initialized: boolean }
export const INITIAL_ACTIVITY_STATE: ActivityPagerState = { events: [], nextCursor: null, loading: false, error: null, initialized: false };

/** One request per page; generation guards prevent refreshed feeds taking stale results. */
export function createActivityPager(fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<ActivityPage>, notify: (state: ActivityPagerState) => void) {
  let state = { ...INITIAL_ACTIVITY_STATE };
  let generation = 0;
  let controller: AbortController | null = null;
  const publish = (patch: Partial<ActivityPagerState>) => { state = { ...state, ...patch }; notify(state); };
  async function run(reset: boolean) {
    if (!reset && (state.loading || (state.initialized && !state.nextCursor))) return;
    const current = reset ? ++generation : generation;
    if (reset) controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const cursor = reset ? null : state.nextCursor;
    publish(reset ? { ...INITIAL_ACTIVITY_STATE, loading: true } : { loading: true, error: null });
    try {
      const page = await fetchPage(cursor, signal);
      if (current !== generation || signal.aborted) return;
      const seen = new Set(state.events.map(event => event.id));
      publish({ events: [...state.events, ...page.events.filter(event => { if (seen.has(event.id)) return false; seen.add(event.id); return true; })], nextCursor: page.nextCursor, initialized: true, loading: false });
    } catch {
      if (current !== generation || signal.aborted) return;
      publish({ loading: false, error: "שגיאה בטעינת הפעילות. אפשר לנסות שוב." });
    }
  }
  return { refresh: () => run(true), loadMore: () => run(false), retry: () => run(!state.initialized), dispose: () => { generation++; controller?.abort(); } };
}
export function activityNearBottom(element: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 160;
}
