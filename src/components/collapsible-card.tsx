"use client";

import { useState } from "react";
import { HEADER_BUTTON } from "@/components/ui";
import { btnPrimary } from "@/components/repairs/styles";

/**
 * A navy-header card whose body can be collapsed from a button in the header.
 * The body stays mounted when collapsed (just hidden), so anything running
 * inside it (a search, a form) keeps its state.
 */
export function CollapsibleCard({
  title,
  hint,
  defaultOpen = true,
  action,
  labels,
  collapsedSummary,
  children,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  /** Buttons on the right of the header, before Collapse. */
  action?: React.ReactNode;
  /** Replaces "Collapse" / "Expand" on the header button (for example "Close" / "Edit search"). */
  labels?: { close: string; open: string };
  /** Shown in the body while it is collapsed, so a closed card still says what is in it. */
  collapsedSummary?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Closed with a summary: just a card with the summary and the open button on its right (no navy header).
  const summaryCard = !open && collapsedSummary;
  return (
    <section className="rounded-xl border border-line bg-paper">
      {summaryCard ? (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
          <div className="min-w-0 flex-1">{collapsedSummary}</div>
          <button type="button" onClick={() => setOpen(true)} aria-expanded={false} className={`${btnPrimary} shrink-0 px-6`}>
            {labels?.open ?? "Expand"}
          </button>
        </div>
      ) : (
      <header className="rounded-t-[7px] band bg-ink px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="eyebrow text-paper">{title}</h2>
            {hint ? <p className="mt-1.5 text-[13px] text-ondark-mute">{hint}</p> : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {action}
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={HEADER_BUTTON}>
            {open ? (labels?.close ?? "Collapse") : (labels?.open ?? "Expand")}
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`transition-transform ${open ? "rotate-90" : ""}`}>
              <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          </div>
        </div>
      </header>
      )}
      <div hidden={!open} className="px-5 py-4">
        {children}
      </div>
    </section>
  );
}
