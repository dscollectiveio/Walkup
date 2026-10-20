import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
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
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { UrgentItem } from "@/lib/home/urgent-items";
import { WorthCarousel } from "./worth-carousel";
import { FoldSection } from "./fold-section";

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
  access_ending: UserRound,
  term_ending: Users,
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

/**
 * "Worth a minute today": the few conditions that most need a board member,
 * as the top subsection of the Dashboard's to-do card (todo-card.tsx). Small
 * cards scroll sideways, two at a time; none are dropped. With nothing to
 * flag it says so in one quiet line.
 */
export function WorthAMinute({ items, emptyNote }: { items: UrgentItem[]; emptyNote: string }) {
  const needsAttention = items.filter((i) => i.tone === "bad").length;

  return (
    <FoldSection
      id="worth-a-minute"
      title="Worth a minute today"
      summary={
        items.length > 0 ? (
          <span className="text-[11px] font-medium normal-case tracking-normal text-mute">
            {items.length} to look at
            {needsAttention > 0 ? (
              <span className="text-bad-text"> · {needsAttention} need{needsAttention === 1 ? "s" : ""} attention</span>
            ) : null}
          </span>
        ) : null
      }
    >
      {items.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-3">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-good-line bg-good-tint text-good-text"
          >
            <CircleCheck size={15} strokeWidth={1.8} />
          </span>
          <p className="text-[13px] text-mute">
            <span className="font-semibold text-ink">All clear today.</span> {emptyNote}
          </p>
        </div>
      ) : items.length === 1 ? (
        <ul className="px-2 py-2">
          <li className="flex">
            <ItemCard item={items[0]} />
          </li>
        </ul>
      ) : (
        <WorthCarousel count={items.length}>
          {items.map((item) => (
            <li key={`${item.key}-${item.title}`} className="flex min-w-0 max-w-full shrink-0 grow-0 basis-full snap-start">
              <ItemCard item={item} />
            </li>
          ))}
        </WorthCarousel>
      )}
    </FoldSection>
  );
}

/** One flag as a slim row: icon and two short lines on the left, the button to the issue on the right. */
function ItemCard({ item }: { item: UrgentItem }) {
  const Icon = ICONS[item.key];
  const tone = TONE[item.tone];
  return (
    <article className="relative flex w-full min-w-0 max-w-full items-center gap-2.5 overflow-hidden rounded-lg border border-line bg-bone/50 py-1 pl-3.5 pr-1.5">
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${tone.accent}`} />
      <span
        aria-hidden="true"
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${tone.tile}`}
      >
        <Icon size={14} strokeWidth={1.6} />
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="truncate text-[13px] font-semibold leading-snug text-ink" title={item.title}>
          <span className="sr-only">{tone.label}: </span>
          {item.title}
        </h4>
        <p className="truncate text-[11.5px] leading-snug text-mute" title={item.why}>
          {item.why}
        </p>
      </div>
      <Link
        href={item.action.href}
        className={`inline-flex min-h-[30px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[12px] font-medium transition-colors ${tone.button} ${item.tone === "bad" ? "nudge-needed" : ""}`}
      >
        {item.action.label}
        <ArrowRight size={13} strokeWidth={1.8} aria-hidden="true" />
      </Link>
    </article>
  );
}
