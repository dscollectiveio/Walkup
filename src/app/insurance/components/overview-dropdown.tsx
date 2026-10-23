import { ChevronDown } from "lucide-react";

/**
 * A dropdown on the Insurance Overview: a navy bar with the title and a short line about what is inside, and the
 * full details underneath when it is opened. Plain HTML details, so it works with no script, and `open` lets a
 * link from another page (`?open=policies`) land with it already open.
 */
export function OverviewDropdown({
  id,
  title,
  summary,
  open = false,
  children,
}: {
  id: string;
  title: string;
  summary?: React.ReactNode;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details id={id} open={open} className="group scroll-mt-24 overflow-hidden rounded-xl border border-line bg-paper">
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 band bg-ink px-5 py-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="eyebrow block text-paper">{title}</span>
          {summary ? <span className="mt-0.5 block text-[12px] text-ondark-mute">{summary}</span> : null}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-paper">
          <span className="group-open:hidden">Show details</span>
          <span className="hidden group-open:inline">Hide details</span>
          <ChevronDown size={16} strokeWidth={2} aria-hidden="true" className="transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="space-y-6 p-4 md:p-5">{children}</div>
    </details>
  );
}
