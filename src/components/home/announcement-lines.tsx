"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, Paperclip, Pin, X } from "lucide-react";
import { longDate, shortDate } from "@/lib/dates";
import {
  IMPORTANCE_LABEL,
  announcementPreview,
  type AnnouncementRow,
  type Importance,
} from "@/lib/owner/announcements";
import { markAnnouncementRead } from "@/app/announcements/actions";
import { btnSecondary } from "@/components/repairs/styles";
import type { UrgentItem } from "@/lib/home/urgent-items";
import { ICONS } from "./alert-icons";

/** Each line wears its importance color, as a see-through tint of the composer's Normal / Important / Urgent bubbles. */
const LINE: Record<Importance, { row: string; text: string; muted: string; dot: string; pin: string }> = {
  normal: {
    row: "border border-ink/15 bg-ink/10 hover:bg-ink/15",
    text: "text-ink",
    muted: "text-ink/65",
    dot: "bg-ink",
    pin: "text-ink",
  },
  important: {
    row: "border border-warning/50 bg-warning/20 hover:bg-warning/30",
    text: "text-warning-text",
    muted: "text-warning-text/80",
    dot: "bg-warning",
    pin: "text-warning-text",
  },
  urgent: {
    row: "border border-bad/40 bg-bad/15 hover:bg-bad/25",
    text: "text-bad-text",
    muted: "text-bad-text/80",
    dot: "bg-bad",
    pin: "text-bad-text",
  },
};


/** How long each alert or announcement stays up before the next one slides in. */
const ROTATE_MS = 5000;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(REDUCED_MOTION);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/** One thing in the banner: something that needs a board member, or an announcement from the board. */
type Entry = { kind: "alert"; item: UrgentItem } | { kind: "announcement"; row: AnnouncementRow };

/** An alert wears the announcement colors: needs attention reads as Urgent, when you can as Important. */
const ALERT_LINE: Record<UrgentItem["tone"], Importance> = { bad: "urgent", warning: "important" };

/**
 * The Dashboard banner's alerts and announcements, one at a time. Alerts (the conditions that most need a board
 * member, such as an emergency repair or an unbalanced book) come first, then the board's announcements. Clicking one opens the whole announcement in a
 * pop-out (a native dialog: Esc closes it, focus is trapped, the page behind
 * stays put) instead of leaving the Dashboard. With more than one, they rotate
 * every 7.5 seconds; hovering, focusing or opening one holds it, and people who
 * prefer reduced motion get dots to click through instead. Opening it records that the
 * person read it, the same as the full page does.
 */
export function AnnouncementLines({
  rows,
  alerts = [],
  unreadIds,
  todayIso,
}: {
  rows: AnnouncementRow[];
  alerts?: UrgentItem[];
  unreadIds: string[];
  todayIso: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [read, setRead] = useState<Set<string>>(new Set());
  const open = rows.find((r) => r.id === openId) ?? null;
  const entries: Entry[] = [
    ...alerts.map((item): Entry => ({ kind: "alert", item })),
    ...rows.map((row): Entry => ({ kind: "announcement", row })),
  ];
  const [index, setIndex] = useState(0);
  const [holding, setHolding] = useState(false);
  const [slid, setSlid] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const count = entries.length;
  const safeIndex = count > 0 ? index % count : 0;
  const current = entries[safeIndex] ?? null;
  // Advances every 5 seconds; holds while the pointer or focus is on it or a pop-out is open.
  const rotating = count > 1 && !reducedMotion && openId === null;

  useEffect(() => {
    if (!rotating || holding) return;
    const timer = setTimeout(() => {
      setIndex((i) => (i + 1) % count);
      setSlid(true);
    }, ROTATE_MS);
    return () => clearTimeout(timer);
  }, [rotating, holding, safeIndex, count]);
  function step(by: number) {
    setIndex((safeIndex + by + count) % count);
    setSlid(true);
  }
  const isUnread = (id: string) => unreadIds.includes(id) && !read.has(id);

  function show(id: string) {
    setOpenId(id);
    dialogRef.current?.showModal();
    if (isUnread(id)) {
      setRead((cur) => new Set(cur).add(id));
      void markAnnouncementRead(id).then(() => router.refresh());
    }
  }

  return (
    <>
      <div
        className="flex items-center gap-3 px-3 pb-3 pt-1 min-[900px]:px-5"
        onMouseEnter={() => setHolding(true)}
        onMouseLeave={() => setHolding(false)}
        onFocusCapture={() => setHolding(true)}
        onBlurCapture={() => setHolding(false)}
        aria-roledescription={count > 1 ? "carousel" : undefined}
        aria-label="Alerts and announcements"
      >
        {count > 1 ? (
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink hover:bg-ink/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
          >
            <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
        {/* One slim card at a time. */}
        <div className="h-[3.75rem] min-w-0 flex-1">
          {current?.kind === "announcement" ? (
            <button
              key={current.row.id}
              type="button"
              onClick={() => show(current.row.id)}
              aria-haspopup="dialog"
              aria-live={rotating && !holding ? "off" : "polite"}
              className={`flex h-full w-full flex-col justify-center gap-0.5 rounded-md px-4 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass ${LINE[current.row.importance].row} ${slid ? "announce-in" : ""}`}
            >
              <span className={`flex items-center gap-2.5 text-[14px] leading-5 ${LINE[current.row.importance].text}`}>
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-full ${isUnread(current.row.id) ? LINE[current.row.importance].dot : "bg-transparent"}`}
                />
                {current.row.pinned ? <Pin size={13} strokeWidth={2} aria-label="Pinned" className="shrink-0" /> : null}
                {current.row.importance !== "normal" ? (
                  <span className="shrink-0 rounded-full border border-current px-1.5 py-px text-[10px] font-semibold uppercase">
                    {IMPORTANCE_LABEL[current.row.importance]}
                  </span>
                ) : null}
                <span className={`truncate ${isUnread(current.row.id) ? "font-bold" : "font-semibold"}`}>
                  {current.row.title}
                  {isUnread(current.row.id) ? <span className="sr-only"> (unread)</span> : null}
                </span>
                <span className={`ml-auto shrink-0 pl-2 text-[12px] font-normal ${LINE[current.row.importance].muted}`}>
                  {shortDate((current.row.published_at ?? current.row.created_at).slice(0, 10), todayIso)}
                </span>
              </span>
              <span className={`line-clamp-1 pl-[1.125rem] text-[12.5px] leading-4 ${LINE[current.row.importance].muted}`}>
                {announcementPreview(current.row.body, 220)}
              </span>
            </button>
          ) : current?.kind === "alert" ? (
            <AlertCard key={`${current.item.key}-${current.item.title}`} item={current.item} slid={slid} live={rotating && !holding ? "off" : "polite"} />
          ) : null}
        </div>
        {count > 1 ? (
          <>
            <span className="shrink-0 text-[12px] tabular-nums text-ink/65" aria-hidden="true">
              {safeIndex + 1} of {count}
            </span>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink hover:bg-ink/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
            >
              <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="announcement-popout-title"
        onClose={() => setOpenId(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) dialogRef.current?.close();
        }}
        className="m-auto max-h-[calc(100vh-3rem)] w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-ink/50"
      >
        {open ? (
          <div className="flex max-h-[calc(100vh-3rem)] flex-col">
            <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
              <div className="min-w-0">
                {open.importance !== "normal" || open.pinned ? (
                  <p className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
                    {open.importance !== "normal" ? (
                      <span className={LINE[open.importance].text}>{IMPORTANCE_LABEL[open.importance]}</span>
                    ) : null}
                    {open.pinned ? <span className="text-mute">Pinned</span> : null}
                  </p>
                ) : null}
                <h2 id="announcement-popout-title" className="break-words text-[18px] font-bold tracking-tight text-ink">
                  {open.title}
                </h2>
                <p className="mt-1 text-[12px] text-mute">
                  {open.published_at ? longDate(open.published_at) : ""}
                  {open.edited_at ? " · Edited" : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => dialogRef.current?.close()}
                aria-label="Close"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-mute hover:bg-fill hover:text-ink"
              >
                <X size={16} strokeWidth={1.6} aria-hidden="true" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{open.body}</div>
              {open.attachment_document_id ? (
                <p className="mt-4 flex items-center gap-2 text-[13px] text-mute">
                  <Paperclip size={14} strokeWidth={1.8} aria-hidden="true" />
                  This one has a file attached. Open the full announcement to get it.
                </p>
              ) : null}
            </div>
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-3">
              <Link href={`/announcements/${open.id}`} className={btnSecondary}>
                Open full announcement
              </Link>
              <button type="button" onClick={() => dialogRef.current?.close()} className={btnSecondary}>
                Close
              </button>
            </footer>
          </div>
        ) : null}
      </dialog>
    </>
  );
}

/** An alert in the banner: the whole line links to the thing to fix. */
function AlertCard({ item, slid, live }: { item: UrgentItem; slid: boolean; live: "off" | "polite" }) {
  const Icon = ICONS[item.key];
  const look = LINE[ALERT_LINE[item.tone]];
  return (
    <Link
      href={item.action.href}
      aria-live={live}
      className={`flex h-full w-full flex-col justify-center gap-0.5 rounded-md px-4 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass ${look.row} ${slid ? "announce-in" : ""}`}
    >
      <span className={`flex items-center gap-2.5 text-[14px] leading-5 ${look.text}`}>
        <Icon size={15} strokeWidth={2} aria-hidden="true" className="shrink-0" />
        <span className="shrink-0 rounded-full border border-current px-1.5 py-px text-[10px] font-semibold uppercase">
          {item.tone === "bad" ? "Needs attention" : "When you can"}
        </span>
        <span className="truncate font-semibold">{item.title}</span>
        <ChevronRight size={14} strokeWidth={2} aria-hidden="true" className="ml-auto shrink-0" />
      </span>
      <span className={`line-clamp-1 pl-[1.375rem] text-[12.5px] leading-4 ${look.muted}`}>{item.why}</span>
    </Link>
  );
}
