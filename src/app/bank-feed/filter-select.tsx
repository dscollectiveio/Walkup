"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * A pick-one dropdown that looks and behaves like the category picker (same
 * field, chevron and list), without the typing: used for the date range and
 * bank account filters. Arrow keys move, Enter picks, Escape closes.
 */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  /** Accessible name, e.g. "Date range". */
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const listId = `${useId()}-list`;
  const [open, setOpen] = useState(false);
  const selectedIdx = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const [active, setActive] = useState(selectedIdx);
  const chosen = options[selectedIdx];

  const pick = (o: FilterOption) => {
    onChange(o.value);
    setOpen(false);
  };

  return (
    <div className={`relative min-w-[9rem] ${className}`}>
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setActive(selectedIdx);
          setOpen((v) => !v);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) {
              setActive(selectedIdx);
              setOpen(true);
            } else setActive(Math.min(active + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (open) setActive(Math.max(active - 1, 0));
          } else if (e.key === "Enter" && open && options[active]) {
            e.preventDefault();
            pick(options[active]);
          } else if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        className="w-full truncate rounded-lg border border-line-strong bg-paper py-1.5 pl-2.5 pr-8 text-left min-h-[44px] text-[16px] text-ink sm:min-h-0 sm:text-[12px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brass"
      >
        {chosen?.label ?? ""}
      </button>
      <ChevronDown
        size={14}
        strokeWidth={1.6}
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-mute"
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 top-full z-20 mt-1 max-h-64 w-max min-w-full max-w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-line-strong bg-paper py-1 shadow-lg"
        >
          {options.map((o, idx) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              // mousedown would blur the button (closing the list) before click fires.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(idx)}
              onClick={() => pick(o)}
              className={`cursor-pointer px-2.5 py-3 text-[13px] sm:whitespace-nowrap sm:py-1 sm:text-[12px] ${
                idx === active ? "bg-ink/10 text-ink" : "text-ink"
              } ${o.value === value ? "font-medium" : ""}`}
            >
              {o.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
