"use client";

import { useEffect, useId, useState } from "react";
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

  // A link to something inside it (the Problems tab's "Add documents" goes to #documents) opens it first,
  // then scrolls there, since the section is closed and the target is hidden until it opens.
  useEffect(() => {
    const check = () => {
      const target = window.location.hash.slice(1);
      if (!target) return;
      setOpen(true);
      requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: "start" }));
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

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
