"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * "More about this problem" (repairs-spec §5.3): money, insurance, emails,
 * documents, Walkup's suggestion and duplicates, closed by default so the
 * phone view stays at eight cards. A button with aria-expanded, not a bare
 * <details>, so the state is announced the same way everywhere.
 */
export function MoreAbout({ children, defaultOpen = false }: { children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="rounded-xl border border-line bg-paper">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={`flex min-h-[52px] w-full items-center justify-between gap-3 band bg-ink px-5 py-3 text-left ${open ? "rounded-t-[7px]" : "rounded-[7px]"}`}
      >
        <span className="eyebrow text-paper">More about this problem</span>
        <ChevronDown size={18} aria-hidden="true" className={`text-paper transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>
      <div id={id} hidden={!open} className="space-y-4 border-t border-line px-3 py-4 sm:px-4">
        {children}
      </div>
    </section>
  );
}
