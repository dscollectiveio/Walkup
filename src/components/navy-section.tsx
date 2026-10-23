/**
 * A titled section with the navy header band every card in the app has, for the places that are a form or a worked
 * page rather than a Card (the insurance review and building facts forms, the switching checklist). Same band, same
 * border; the body keeps whatever spacing the caller needs.
 */
export function NavySection({
  title,
  id,
  hint,
  bodyClassName = "space-y-5",
  children,
}: {
  title: string;
  id?: string;
  hint?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id ? `${id}-title` : undefined} id={id} className="rounded-xl border border-line bg-paper">
      <header className="rounded-t-[7px] band bg-ink px-5 py-3">
        <h2 id={id ? `${id}-title` : undefined} className="eyebrow text-paper">
          {title}
        </h2>
        {hint ? <p className="mt-1 text-[13px] text-ondark-mute">{hint}</p> : null}
      </header>
      <div className={`px-5 py-4 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
