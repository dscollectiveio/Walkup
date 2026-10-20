"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A row of slim cards that scrolls sideways, one in view at a time.
 * Arrow buttons page through it; the row also scrolls by touch, trackpad or
 * keyboard. Arrows only show when there is more than one page to reach.
 */
export function WorthCarousel({ children, count }: { children: ReactNode; count: number }) {
  const row = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  // Which way there is more to scroll to. The observer's first callback gives the initial reading.
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      const next = { left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 };
      setEdge((cur) => (cur.left === next.left && cur.right === next.right ? cur : next));
    };
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [count]);
  const page = (dir: 1 | -1) => {
    const el = row.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const arrow =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-strong bg-paper text-ink shadow-sm hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass";
  // The arrows flank the row (not over it, where they would cover each card's button). Their slots
  // keep their width when an arrow hides, so the cards don't shift.
  return (
    <div className="flex items-center gap-1.5 px-2 py-2">
      <span className="h-7 w-7 shrink-0">
        {edge.left ? (
          <button type="button" onClick={() => page(-1)} aria-label="Previous item" className={arrow}>
            <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </span>
      <ul
        ref={row}
        tabIndex={0}
        aria-label="Items worth a minute, scroll sideways for more"
        className="worth-row flex min-w-0 flex-1 snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass motion-reduce:scroll-auto"
      >
        {children}
      </ul>
      <span className="h-7 w-7 shrink-0">
        {edge.right ? (
          <button type="button" onClick={() => page(1)} aria-label="Next item" className={arrow}>
            <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </span>
    </div>
  );
}
