"use client";

/** What a shared-store hook returns about its last load (useDocuments / useExpenses / useClients). */
export type StoreLoadSource = { error: string | null; retry: () => void };

/** The first failed store among the ones a page reads, or null when all loaded. */
export function failedStore(sources: StoreLoadSource[]): StoreLoadSource | null {
  return sources.find((s) => s.error) ?? null;
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
