import Link from "next/link";
import {
  BarChart3,
  CalendarClock,
  ChevronRight,
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
 * at the top of the Dashboard's to-do card (todo-card.tsx), with no header of
 * its own. Small cards scroll sideways; none are dropped. With nothing to
 * flag it says so in one quiet line.
 */
export function WorthAMinute({ items, emptyNote }: { items: UrgentItem[]; emptyNote: string }) {
  return (
    <section id="worth-a-minute" aria-label="Worth a minute today">
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
            <li key={`${item.key}-${item.title}`} className="flex min-w-0 max-w-full shrink-0 grow-0 basis-[calc(50%-0.25rem)] snap-start">
              <ItemCard item={item} />
            </li>
          ))}
        </WorthCarousel>
      )}
    </section>
  );
}

/**
 * One flag, styled like the books notice on "Where the association stands": a single tinted line with a small
 * icon, the title and the reason, and an arrow. The whole line is the link to the issue.
 */
function ItemCard({ item }: { item: UrgentItem }) {
  const Icon = ICONS[item.key];
  const tone = TONE[item.tone];
  return (
    <Link
      href={item.action.href}
      aria-label={`${tone.label}: ${item.title}. ${item.action.label}`}
      className={`flex min-h-[3.75rem] w-full min-w-0 max-w-full items-center gap-2 rounded-md border px-3 py-2 text-[12px] font-medium hover:brightness-[0.98] ${tone.tile}`}
    >
      <Icon size={16} strokeWidth={2} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1" title={`${item.title}. ${item.why}`}>
        <span className="block truncate font-semibold">{item.title}</span>
        <span className="line-clamp-2 font-normal leading-snug opacity-80">{item.why}</span>
      </span>
      <ChevronRight size={14} strokeWidth={2} aria-hidden="true" className="shrink-0" />
    </Link>
  );
}
