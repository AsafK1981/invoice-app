/**
 * Generic module-level shared data store, used by the app's `useDocuments` /
 * `useClients` / `useProducts` / `useExpenses` hooks (document-store.ts,
 * client-store.ts, product-store.ts, expense-store.ts).
 *
 * Before this, every mounted consumer of one of those hooks ran its OWN
 * Supabase fetch and kept its OWN React state, even when several consumers
 * on the same page needed the exact same rows (e.g. global-search.tsx +
 * the page itself). A store created with `createSharedStore` is a single
 * module-level singleton: one fetch, one snapshot, all subscribers notified
 * together and concurrent `refetch()` calls collapse into one in-flight
 * request.
 *
 * Consumers read the snapshot with React's `useSyncExternalStore`, which is
 * why `getSnapshot` must return a referentially stable value between calls
 * unless the underlying data actually changed.
 */

export type SharedStoreState<T> = {
  data: T;
  ready: boolean;
};

export type SharedStore<T> = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => SharedStoreState<T>;
  getServerSnapshot: () => SharedStoreState<T>;
  refetch: () => Promise<void>;
};

/**
 * `fetcher` resolves the full dataset. Returning `undefined` means "skip -
 * nothing to fetch yet" (mirrors the original hooks' `if (!bid) return`):
 * the store keeps whatever it already had and stays `ready: false` until a
 * real fetch succeeds. `emptyValue` is both the initial snapshot's data and
 * the SSR snapshot (`getServerSnapshot`), so server rendering never touches
 * the browser-only fetch path.
 */
export function createSharedStore<T>(
  fetcher: () => Promise<T | undefined>,
  emptyValue: T,
  /**
   * Runs once, on the FIRST subscribe (never during SSR, never for a store no
   * component on the page actually reads). This is where the store wires its
   * triggers - the business-ready hook and the change event. Doing it lazily
   * keeps a page that never renders, say, expenses from fetching them.
   */
  onStart?: (refetch: () => Promise<void>) => void,
): SharedStore<T> {
  let state: SharedStoreState<T> = { data: emptyValue, ready: false };
  // useSyncExternalStore requires getServerSnapshot to return the SAME object
  // every call, or React warns and can loop during hydration.
  const serverState: SharedStoreState<T> = { data: emptyValue, ready: false };
  const listeners = new Set<() => void>();
  let inFlight: Promise<void> | null = null;
  // A refetch requested while one is already running (e.g. a save fires the
  // change event mid-initial-load) must not be silently coalesced into the
  // older request, which started before the write and would miss it. Mark it
  // and run one more fetch when the current one settles.
  let rerunWanted = false;
  let started = false;

  function notify() {
    for (const listener of listeners) listener();
  }

  function refetch(): Promise<void> {
    if (inFlight) {
      rerunWanted = true;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        do {
          rerunWanted = false;
          const data = await fetcher();
          if (data !== undefined) {
            state = { data, ready: true };
            notify();
          }
        } while (rerunWanted);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!started) {
        started = true;
        onStart?.(refetch);
      }
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return state;
    },
    getServerSnapshot() {
      return serverState;
    },
    refetch,
  };
}
