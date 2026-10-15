import { ChevronDown } from "lucide-react";

/**
 * A collapsed section inside a card: a title, a one-line summary, and a
 * chevron. Opens to show its content. Native <details>, so it works without
 * script and by keyboard.
 */
export function DetailsPanel({
  title,
  summary,
  badge,
  children,
}: {
  title: string;
  summary?: string;
  /** A short count or status shown on the right of the title row. */
  badge?: string | null;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-lg border border-line">
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 hover:bg-fill [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-[13px] font-bold text-ink">{title}</span>
          {summary ? <span className="block text-[12px] text-mute">{summary}</span> : null}
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {badge ? <span className="rounded-full border border-line bg-fill px-2.5 py-0.5 text-[11px] font-medium text-ink">{badge}</span> : null}
          <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" className="text-mute transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="space-y-4 border-t border-line px-4 py-4">{children}</div>
    </details>
  );
}
