export default function AppLoading() {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="h-7 w-44 rounded-lg bg-stone-200 animate-pulse" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card-soft p-5 space-y-3">
            <div className="h-3 w-20 rounded bg-stone-200 animate-pulse" />
            <div className="h-7 w-28 rounded bg-stone-200 animate-pulse" />
            <div className="h-3 w-32 rounded bg-stone-200 animate-pulse" />
          </div>
        ))}
      </div>
      <div className="card-soft p-5 space-y-3">
        <div className="h-4 w-40 rounded bg-stone-200 animate-pulse" />
        <div className="h-40 rounded-xl bg-stone-100 animate-pulse" />
      </div>
    </div>
  );
}
