/**
 * Instant navigation feedback. Next.js shows this the moment a nav click
 * starts, before the target route's own data has come back — without it,
 * a click on a dynamic (force-dynamic) page just sits there with no
 * feedback until every query on the target page resolves, which reads as
 * "the app is slow" even when the actual data fetch is perfectly normal.
 * One of these per route segment folder (see loading.tsx alongside it).
 */
export function RouteLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-hidden="true">
      <div className="space-y-2">
        <div className="h-5 w-48 rounded bg-fill" />
        <div className="h-3 w-72 rounded bg-fill" />
      </div>
      <div className="rounded-xl border border-line bg-paper p-5">
        <div className="h-4 w-32 rounded bg-fill" />
        <div className="mt-4 space-y-3">
          <div className="h-3 w-full rounded bg-fill" />
          <div className="h-3 w-5/6 rounded bg-fill" />
          <div className="h-3 w-2/3 rounded bg-fill" />
        </div>
      </div>
    </div>
  );
}
