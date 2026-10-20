import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { daysUntil, formatDueDate, railFor, type Reminder } from "@/lib/home/reminders";
import { ESTIMATED_NOTE } from "@/lib/tax/copy";

const RAIL = {
  bad: "bg-bad",
  warning: "bg-warning",
  neutral: "bg-line-strong",
} as const;

// The one shared sentence (lib/tax/copy), lowercased to sit after a middle
// dot: "estimated — not yet checked against this year's instructions".
const ESTIMATED_WORDS = ESTIMATED_NOTE.charAt(0).toLowerCase() + ESTIMATED_NOTE.slice(1).replace(/\.$/, "");

/** Whole days since a date that has passed — at least one, or it wouldn't be overdue. */
function daysLate(due: Date, today: Date): number {
  return Math.max(1, Math.round((today.getTime() - due.getTime()) / 86400000));
}

/**
 * Deadlines sorted by proximity: a big day count, a severity rail, and the
 * date. The rail is never the only carrier — the day count says it in
 * numbers right next to it. An overdue row keeps its real date and counts
 * the days since instead of reading as "0 days".
 */
export function ComingUp({ reminders, today }: { reminders: Reminder[]; today: Date }) {
  return (
    <section className="flex max-h-[30rem] flex-col rounded-xl border border-line bg-paper lg:max-h-none">
      <header className="flex min-h-[4rem] flex-col justify-center rounded-t-[7px] band bg-ink px-5 py-3">
        <h2 className="eyebrow text-paper">Coming up</h2>
        <p className="mt-0.5 text-[12px] text-ondark-mute">
          Deadlines from your own records, plus the filings every association has.
        </p>
      </header>
      {/* On desktop the list is absolutely positioned so it never sets the row's height: the row is as tall
          as the building card beside it, and this scrolls when there are more rows than fit. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto lg:overflow-visible">
      <ul className="divide-y divide-line px-5 lg:absolute lg:inset-0 lg:overflow-y-auto">
        {reminders.slice(0, 6).map((r, i) => {
          const days = daysUntil(r.due, today);
          const late = r.overdue ? daysLate(r.due, today) : 0;
          return (
            <li key={`${r.name}-${r.kind}-${r.due.toISOString()}-${i}`} className={`relative flex items-center gap-3 py-3 ${r.href ? "-mx-5 px-5 hover:bg-fill/60" : ""}`}>
              <span className="w-12 shrink-0 text-right">
                <span className="figures block text-[18px] leading-none text-ink">{r.overdue ? late : days}</span>
                <span className="block whitespace-nowrap text-[10px] text-mute-soft">
                  {r.overdue ? `day${late === 1 ? "" : "s"} late` : `day${days === 1 ? "" : "s"}`}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={`h-9 w-[3px] shrink-0 rounded-full ${RAIL[r.overdue ? "bad" : railFor(days)]}`}
              />
              <span className="min-w-0 flex-1">
                {r.href ? (
                  <Link href={r.href} className="block text-[13px] font-medium text-ink underline-offset-2 after:absolute after:inset-0 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brass">
                    {r.name}
                  </Link>
                ) : (
                  <span className="block text-[13px] font-medium text-ink">{r.name}</span>
                )}
                <span className="block text-[11px] text-mute">
                  {r.kind}
                  {r.unverified ? <span className="text-mute-soft"> · {ESTIMATED_WORDS}</span> : null}
                </span>
              </span>
              <span className={`tabular shrink-0 text-[12px] ${r.overdue ? "text-bad-text" : "text-mute"}`}>
                {r.overdue ? `was due ${formatDueDate(r.due, today)}` : formatDueDate(r.due, today)}
              </span>
              {r.href ? <ChevronRight size={15} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-mute-soft" /> : null}
            </li>
          );
        })}
      </ul>
      </div>
    </section>
  );
}
