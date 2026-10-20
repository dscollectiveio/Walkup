"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarPlus, ChevronDown } from "lucide-react";

const ICS = "/repairs/calendar";

const item =
  "flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-fill focus-visible:bg-fill focus-visible:outline-none";

/**
 * "Add to calendar" with a choice of Apple Calendar, Outlook or Google
 * Calendar. All three take the same .ics file (imported once; Walkup sends no
 * updates). Apple and Outlook open the downloaded file; Google can only import
 * a file from its own settings page, so that one also opens it in a new tab.
 */
export function AddToCalendarMenu({ buttonClass }: { buttonClass: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={box}
      className="relative"
      onBlur={(e) => {
        // Tabbing out of the whole control closes it.
        if (open && !box.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button ref={trigger} type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={open ? id : undefined} className={`${buttonClass} gap-1.5`}>
        <CalendarPlus size={15} strokeWidth={1.8} aria-hidden="true" />
        Add to calendar
        <ChevronDown size={14} strokeWidth={2} aria-hidden="true" className={open ? "rotate-180" : ""} />
      </button>
      {open ? (
        <div id={id} className="absolute right-0 z-30 mt-1 w-72 overflow-hidden rounded-lg border border-line-strong bg-paper shadow-lg">
          <a href={ICS} download="walkup-upkeep.ics" onClick={() => setOpen(false)} className={item}>
            <span>
              <span className="block text-[13px] font-medium text-ink">Apple Calendar</span>
              <span className="block text-[11px] text-mute">Downloads the file. Open it and Calendar adds the events.</span>
            </span>
          </a>
          <a href={ICS} download="walkup-upkeep.ics" onClick={() => setOpen(false)} className={`${item} border-t border-line`}>
            <span>
              <span className="block text-[13px] font-medium text-ink">Outlook</span>
              <span className="block text-[11px] text-mute">Downloads the file. Open it in Outlook to add the events.</span>
            </span>
          </a>
          <a
           
            href={ICS}
            download="walkup-upkeep.ics"
            onClick={() => {
              window.open("https://calendar.google.com/calendar/u/0/r/settings/export", "_blank", "noopener,noreferrer");
              setOpen(false);
            }}
            className={`${item} border-t border-line`}
          >
            <span>
              <span className="block text-[13px] font-medium text-ink">Google Calendar</span>
              <span className="block text-[11px] text-mute">Downloads the file and opens Google&rsquo;s Import page. Choose the file there.</span>
            </span>
          </a>
          <p className="border-t border-line bg-fill/40 px-3 py-2 text-[11px] text-mute">
            It imports once. Download it again after the schedule changes; Walkup doesn&rsquo;t send updates.
          </p>
        </div>
      ) : null}
    </div>
  );
}
