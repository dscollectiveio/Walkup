import { daysUntil, formatDueDate, railFor, type Reminder } from "@/lib/home/reminders";

const RAIL = {
  bad: "bg-bad",
  warning: "bg-warning",
  neutral: "bg-line-strong",
} as const;

/**
 * Deadlines sorted by proximity: a big day count, a severity rail, and the
 * date. The rail is never the only carrier — the day count says it in
 * numbers right next to it.
 */
export function ComingUp({ reminders, today }: { reminders: Reminder[]; today: Date }) {
  return (
    <section className="rounded-xl border border-line bg-paper">
      <header className="border-b border-line px-5 py-4">
        <h2 className="font-semibold tracking-tight text-ink">Coming up</h2>
        <p className="mt-1 text-[13px] text-mute">
          Deadlines from your own records, plus the filings every association has.
        </p>
      </header>
      <ul className="divide-y divide-line px-5">
        {reminders.slice(0, 6).map((r) => {
          const days = daysUntil(r.due, today);
          return (
            <li key={`${r.name}-${r.due.toISOString()}`} className="flex items-center gap-3 py-3">
              <span className="w-12 shrink-0 text-right">
                <span className="figures block text-[18px] leading-none text-ink">{days}</span>
                <span className="block text-[10px] text-mute-soft">
                  day{days === 1 ? "" : "s"}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={`h-9 w-[3px] shrink-0 rounded-full ${RAIL[railFor(days)]}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink">{r.name}</span>
                <span className="block text-[11px] text-mute">
                  {r.kind}
                  {r.unverified ? (
                    <span className="text-mute-soft">
                      {" "}
                      · not yet checked against this year&rsquo;s instructions
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="tabular shrink-0 text-[12px] text-mute">
                {formatDueDate(r.due, today)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
