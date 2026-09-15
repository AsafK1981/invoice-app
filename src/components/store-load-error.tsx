"use client";

/**
 * What a shared-store hook returns about its last load (useDocuments /
 * useExpenses / useClients). `ready` is true once a load has ever succeeded:
 * a store that failed a later refresh keeps its last good rows.
 */
export type StoreLoadSource = { error: string | null; retry: () => void; ready?: boolean };

/** The first failed store among the ones a page reads, or null when all loaded. */
export function failedStore(sources: StoreLoadSource[]): StoreLoadSource | null {
  return sources.find((s) => s.error) ?? null;
}

/**
 * A failure that leaves the page with nothing trustworthy to show: a store
 * that never loaded. A failed refresh over good rows is not blocking; show
 * StoreRefreshBanner above the page instead of hiding it.
 */
export function blockingStoreFailure(sources: StoreLoadSource[]): StoreLoadSource | null {
  return sources.find((s) => s.error && s.ready === false) ?? null;
}

/** Inline notice over the last good rows when a background refresh failed. */
export function StoreRefreshBanner({ sources }: { sources: StoreLoadSource[] }) {
  const stale = sources.filter((s) => s.error && s.ready !== false);
  if (stale.length === 0) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span>הרענון האחרון של הנתונים נכשל, מוצגים הנתונים שנטענו קודם.</span>
      <button type="button" className="font-semibold underline" onClick={() => stale.forEach((s) => s.retry())}>
        רענן שוב
      </button>
    </div>
  );
}

/**
 * Shown instead of a page's numbers when one of its shared stores failed to
 * load. Without it a failed fetch rendered as "no documents yet" or as a
 * report full of zeros. The retry button reloads every failed store.
 */
export function StoreLoadError({ sources }: { sources: StoreLoadSource[] }) {
  const failed = failedStore(sources);
  if (!failed) return null;
  return (
    <div role="alert" className="p-6 rounded-2xl bg-amber-50 text-amber-900">
      <p>{failed.error}</p>
      <button
        type="button"
        className="pgbtn pgbtn-quiet mt-3"
        onClick={() => {
          for (const s of sources) if (s.error) s.retry();
        }}
      >
        ניסיון נוסף
      </button>
    </div>
  );
}
