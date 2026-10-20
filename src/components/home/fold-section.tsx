"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { SECTION_HEADER } from "@/components/section-header";

/** "Show ⌄" when closed, "Hide ⌃" when open: the arrow points the way the content will move. */
export function ShowHide({ shown }: { shown: boolean }) {
  const Arrow = shown ? ChevronUp : ChevronDown;
  return (
    <span className="hidden w-16 shrink-0 items-center justify-end gap-1 text-[11px] font-medium normal-case tracking-normal text-ink sm:flex">
      {shown ? "Hide" : "Show"}
      <Arrow size={14} strokeWidth={2.2} aria-hidden="true" />
    </span>
  );
}

/**
 * A subsection with a soft header bar that folds its body away. The whole
 * bar is the toggle (the title button carries the keyboard and screen-reader
 * semantics); `summary` stays on the bar either way, so a folded
 * section still says what's in it.
 */
export function FoldSection({
  id,
  title,
  summary,
  children,
}: {
  id: string;
  title: string;
  summary?: ReactNode;
  children: ReactNode;
}) {
  const [folded, setFolded] = useState(false);
  return (
    <section aria-labelledby={`${id}-title`}>
      <div
        onClick={() => setFolded((f) => !f)}
        className={`flex cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-1 hover:bg-ink/[0.11] ${SECTION_HEADER}`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setFolded((f) => !f);
          }}
          aria-expanded={!folded}
          aria-controls={`${id}-body`}
          className="-my-1 flex min-h-[32px] items-center gap-2 rounded text-left uppercase hover:text-ink-mid focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
        >
          <ChevronDown
            size={15}
            strokeWidth={2}
            aria-hidden="true"
            className={`shrink-0 motion-safe:transition-transform ${folded ? "-rotate-90" : ""}`}
          />
          <h3 id={`${id}-title`}>{title}</h3>
        </button>
        <span className="flex items-center gap-3">
          {summary}
          <ShowHide shown={!folded} />
        </span>
      </div>
      <div id={`${id}-body`} hidden={folded}>
        {children}
      </div>
    </section>
  );
}
