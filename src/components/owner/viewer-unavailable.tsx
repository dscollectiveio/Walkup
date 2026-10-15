/**
 * What an owner page shows when it could not work out who is looking: no
 * person record in this building yet, a sign-in that has not finished two-step
 * verification, or a failed lookup. It says so and asks for a reload; it does
 * not pretend the person has no access (owner-portal-spec 2.3).
 */
export function ViewerUnavailable() {
  return (
    <div className="mx-auto w-full max-w-[640px]">
      <section className="rounded-xl border border-line bg-paper px-5 py-8">
        <h1 className="text-[20px] font-bold tracking-tight text-ink">We couldn&rsquo;t load this page</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink">
          Reload the page. If it keeps happening, sign out and back in, or tell the board.
        </p>
      </section>
    </div>
  );
}
