"use client";

import { useState } from "react";
import { HEADER_BUTTON } from "@/components/ui";

/**
 * A navy-header card whose body can be collapsed from a button in the header.
 * The body stays mounted when collapsed (just hidden), so anything running
 * inside it (a search, a form) keeps its state.
 */
export function CollapsibleCard({
  title,
  hint,
  defaultOpen = true,
  children,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl border border-line bg-paper">
      <header className="rounded-t-[7px] band bg-ink px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="eyebrow text-paper">{title}</h2>
            {hint ? <p className="mt-1.5 text-[13px] text-ondark-mute">{hint}</p> : null}
          </div>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={HEADER_BUTTON}>
            {open ? "Collapse" : "Expand"}
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`transition-transform ${open ? "rotate-90" : ""}`}>
              <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </header>
      <div hidden={!open} className="px-5 py-4">
        {children}
      </div>
    </section>
  );
}
