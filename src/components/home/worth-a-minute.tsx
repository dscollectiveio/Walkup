import Link from "next/link";
import { Scale, Hourglass, Users, Shield, Landmark, type LucideIcon } from "lucide-react";
import type { UrgentItem } from "@/lib/home/urgent-items";

const ICONS: Record<UrgentItem["key"], LucideIcon> = {
  books: Scale,
  delinquent: Hourglass,
  w9: Users,
  insurance: Shield,
  bank: Landmark,
};

/**
 * The triage block. Empty state is handled by the caller — when nothing
 * qualifies, this card is not rendered at all; a quiet good-tint line takes
 * its place instead of an empty card with a zero chip.
 */
export function WorthAMinute({ items }: { items: UrgentItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="border-l-[3px] border-brass bg-warning-tint px-5 py-4">
      <header className="flex items-center gap-2.5">
        <h2 className="text-[14px] font-semibold tracking-tight text-warning-text">
          Worth a minute today
        </h2>
        <span className="rounded-full border border-warning-line bg-paper px-2 py-0.5 text-[11px] font-medium text-warning-text">
          {items.length}
        </span>
      </header>

      <ul className="mt-2 divide-y divide-warning-line">
        {items.map((item) => {
          const Icon = ICONS[item.key];
          const tile =
            item.tone === "bad"
              ? "bg-bad-tint text-bad-text border-bad-line"
              : "bg-paper text-warning-text border-warning-line";
          return (
            <li
              key={item.title}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 sm:flex-nowrap"
            >
              <span
                aria-hidden="true"
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${tile}`}
              >
                <Icon size={15} strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink">{item.title}</span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-mute">
                  {item.why}
                </span>
              </span>
              <Link
                href={item.action.href}
                className="shrink-0 rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid"
              >
                {item.action.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
