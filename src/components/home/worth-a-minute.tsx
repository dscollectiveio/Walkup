import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  ChevronDown,
  CircleCheck,
  FileSearch,
  Hammer,
  Hourglass,
  Landmark,
  Mail,
  RefreshCw,
  Scale,
  Shield,
  ShieldAlert,
  Siren,
  Sparkles,
  TriangleAlert,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { WORTH_A_MINUTE_VISIBLE, type UrgentItem } from "@/lib/home/urgent-items";

const ICONS: Record<UrgentItem["key"], LucideIcon> = {
  books: Scale,
  delinquent: Hourglass,
  w9: Users,
  insurance: Shield,
  bank: Landmark,
  sync: RefreshCw,
  budget: BarChart3,
  insurance_task: FileSearch,
  repairs_emergency: Siren,
  repairs_possible_emergency: TriangleAlert,
  repairs_urgent: Hammer,
  repairs_overdue: CalendarClock,
  upkeep_overdue: Wrench,
  contractor_paperwork: ShieldAlert,
  ai_finished: Sparkles,
  email_key_rejected: Mail,
  email_failed: Mail,
  email_bounced: Mail,
};

const TONE = {
  bad: {
    label: "Needs attention",
    accent: "bg-bad",
    tile: "border-bad-line bg-bad-tint text-bad-text",
    chip: "text-bad-text",
    button: "bg-ink text-paper hover:bg-ink-mid",
  },
  warning: {
    label: "When you can",
    accent: "bg-brass",
    tile: "border-warning-line bg-warning-tint text-warning-text",
    chip: "text-warning-text",
    button: "border border-line-strong bg-paper text-ink hover:bg-fill",
  },
} as const;

/** Grid columns by how many cards are showing, so one or two never sit in a half-empty row. */
const GRID: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
};

/**
 * "Worth a minute today": the few conditions that most need a board member,
 * as a card of small cards. The top few show in full; anything else is one
 * click away under "Show more", never dropped. With nothing to flag, the
 * same card says so, so the dashboard's shape doesn't jump around.
 */
export function WorthAMinute({ items, emptyNote }: { items: UrgentItem[]; emptyNote: string }) {
  const visible = items.slice(0, WORTH_A_MINUTE_VISIBLE);
  const rest = items.slice(WORTH_A_MINUTE_VISIBLE);
  const needsAttention = items.filter((i) => i.tone === "bad").length;

  // Nothing to flag: one quiet row, not a whole card's worth of chrome.
  if (items.length === 0) {
    return (
      <section
        aria-labelledby="worth-a-minute-title"
        className="flex items-center gap-3 rounded-xl border border-line bg-paper px-5 py-4"
      >
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-good-line bg-good-tint text-good-text"
        >
          <CircleCheck size={18} strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <h2 id="worth-a-minute-title" className="text-[14px] font-semibold text-ink">
            All clear today
          </h2>
          <p className="text-[13px] text-mute">{emptyNote}</p>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="worth-a-minute-title" className="rounded-xl border border-line bg-paper">
      <header className="flex min-h-[4.75rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-t-[7px] bg-ink px-5 py-4">
        <div className="min-w-0">
          <h2 id="worth-a-minute-title" className="eyebrow text-paper">
            Worth a minute today
          </h2>
          <p className="mt-0.5 text-[12px] text-ondark-mute">
            The things that most need a board member, most important first.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-paper/10 px-2.5 py-1 text-[12px] font-medium text-paper">
          {items.length} to look at
          {needsAttention > 0 ? <span className="text-ondark-mute"> · {needsAttention} need{needsAttention === 1 ? "s" : ""} attention</span> : null}
        </span>
      </header>

      <ul className={`grid gap-3 p-4 ${GRID[visible.length] ?? GRID[3]}`}>
        {visible.map((item) => (
          <li key={`${item.key}-${item.title}`} className="flex">
            <ItemCard item={item} wide={visible.length === 1} />
          </li>
        ))}
      </ul>

      {rest.length > 0 ? (
        <details className="group border-t border-line">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 px-5 text-[13px] font-medium text-ink hover:bg-fill [&::-webkit-details-marker]:hidden">
            <span>
              Show {rest.length} more
            </span>
            <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" className="text-mute transition-transform group-open:rotate-180" />
          </summary>
          <ul className="divide-y divide-line border-t border-line px-5">
            {rest.map((item) => {
              const Icon = ICONS[item.key];
              const tone = TONE[item.tone];
              return (
                <li key={`${item.key}-${item.title}`} className="flex items-center gap-3 py-3">
                  <span
                    aria-hidden="true"
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${tone.tile}`}
                  >
                    <Icon size={14} strokeWidth={1.7} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-ink">{item.title}</span>
                    <span className={`block text-[11px] ${tone.chip}`}>{tone.label}</span>
                  </span>
                  <Link
                    href={item.action.href}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[12px] font-medium text-ink underline-offset-2 hover:underline"
                  >
                    {item.action.label}
                    <ArrowRight size={13} strokeWidth={1.8} aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function ItemCard({ item, wide }: { item: UrgentItem; wide: boolean }) {
  const Icon = ICONS[item.key];
  const tone = TONE[item.tone];
  return (
    <article
      className={`relative flex w-full overflow-hidden rounded-lg border border-line bg-bone/50 p-4 ${
        wide ? "flex-col gap-4 sm:flex-row sm:items-center" : "flex-col"
      }`}
    >
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${tone.accent}`} />
      <div className={`flex min-w-0 gap-3 ${wide ? "sm:flex-1" : ""}`}>
        <span
          aria-hidden="true"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${tone.tile}`}
        >
          <Icon size={17} strokeWidth={1.6} />
        </span>
        <div className="min-w-0">
          <p className={`text-[11px] font-semibold uppercase tracking-[0.06em] ${tone.chip}`}>{tone.label}</p>
          <h3 className="mt-0.5 text-[14px] font-semibold leading-snug text-ink">{item.title}</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-mute">{item.why}</p>
        </div>
      </div>
      {/* Pinned to the bottom so buttons line up across cards of different heights. */}
      <div className={wide ? "shrink-0" : "mt-auto pt-4"}>
        <Link
          href={item.action.href}
          className={`inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-md px-3.5 text-[13px] font-medium transition-colors ${tone.button} ${
            wide ? "sm:w-auto" : ""
          }`}
        >
          {item.action.label}
          <ArrowRight size={14} strokeWidth={1.8} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
