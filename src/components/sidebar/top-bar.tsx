"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleHelp, LogOut, Menu, X } from "lucide-react";
import { pageTitleFor, type NavRole } from "./config";
import { setDrawerOpen, useSidebarState } from "./sidebar-state";
import { START_TOUR_EVENT } from "@/components/tour/app-tour";

const HELP: { title: string; body: string }[] = [
  {
    title: "Start with the Dashboard",
    body: "The setup guide walks you through everything in order. Steps tick themselves off as you finish them.",
  },
  {
    title: "Once a month: the bank feed",
    body: "Open Bank Feed & Transactions, click the recommended category on each transaction, then post them. About 10 minutes.",
  },
  {
    title: "Dues",
    body: "HOA Dues shows who's paid. Charge each period, then confirm deposits as they land.",
  },
  {
    title: "Something broken?",
    body: "Report it under Repairs & Upkeep. The board assigns a contractor and closes it when it's fixed.",
  },
  {
    title: "Keyboard",
    body: "Press [ to shrink the sidebar to icons and ] to bring it back.",
  },
];

/**
 * The sticky header on every signed-in page: the association and the page
 * you're on at the left; your name, Help and Sign out at the right. On a
 * phone it also carries the menu button that opens the navigation drawer.
 */
export function TopBar({
  associationName,
  userName,
  userEmail,
  signOutAction,
  role = null,
}: {
  associationName: string | null;
  userName: string | null;
  userEmail: string;
  signOutAction: () => Promise<void>;
  /** The viewer's highest role, so the page name matches the sidebar's label. */
  role?: NavRole | null;
}) {
  const pathname = usePathname();
  const { phone } = useSidebarState();
  const helpRef = useRef<HTMLDialogElement>(null);
  const page = pageTitleFor(pathname, role);
  const shownName = userName ?? userEmail;
  // Initials for the profile circle: first letters of the first and last name, else the email's first two.
  const initials = (() => {
    const parts = (userName ?? "").trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return userEmail.slice(0, 2).toUpperCase();
  })();
  const onAccount = pathname === "/account" || pathname.startsWith("/account/") || pathname.startsWith("/billing");

  return (
    <header className="sticky top-0 z-20 flex h-[56px] items-center gap-3 band bg-ink px-4 text-paper min-[900px]:px-6">
      {phone ? (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          className="-ml-1 flex h-9 w-9 items-center justify-center rounded-md text-paper hover:bg-ink-mid"
        >
          <Menu size={18} strokeWidth={1.6} aria-hidden="true" />
        </button>
      ) : null}

      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-[15px] font-semibold text-paper" title={userEmail}>
          {associationName ?? "Walkup"}
          <span className="font-normal text-ondark-mute"> - </span>
          <span className="font-normal">{shownName}</span>
        </span>
        {page ? (
          <>
            <span aria-hidden="true" className="text-ondark-mute">
              ·
            </span>
            <span className="truncate text-[13px] text-ondark-mute">{page}</span>
          </>
        ) : null}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => helpRef.current?.showModal()}
          data-tour="help"
          className="inline-flex h-9 items-center gap-1.5 px-2 text-[13px] font-medium text-paper underline decoration-paper/50 underline-offset-4 transition-colors duration-300 hover:decoration-paper"
        >
          <CircleHelp size={15} strokeWidth={1.6} aria-hidden="true" />
          <span className="hidden sm:inline">Help</span>
          <span className="sr-only sm:hidden">Help</span>
        </button>
        <form action={signOutAction}>
          <button
            type="submit"
            className="inline-flex h-9 items-center gap-1.5 px-2 text-[13px] font-medium text-paper underline decoration-paper/50 underline-offset-4 transition-colors duration-300 hover:decoration-paper"
          >
            <LogOut size={15} strokeWidth={1.6} aria-hidden="true" />
            <span className="hidden sm:inline">Sign out</span>
            <span className="sr-only sm:hidden">Sign out</span>
          </button>
        </form>
        <Link
          href="/account"
          data-tour="account"
          aria-label="Your account"
          aria-current={onAccount ? "page" : undefined}
          title={`Your account (${shownName})`}
          className={`ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#D9A441] text-[13px] font-bold text-[#1B2A41] ring-2 transition duration-300 hover:scale-105 hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper ${
            onAccount ? "ring-paper" : "ring-transparent"
          }`}
        >
          {initials}
        </Link>
      </div>

      <dialog
        ref={helpRef}
        aria-labelledby="help-title"
        onClick={(e) => {
          if (e.target === helpRef.current) helpRef.current?.close();
        }}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-paper p-0 text-ink shadow-xl backdrop:bg-ink-deep/40"
      >
        <div className="flex items-start justify-between gap-4 rounded-t-[11px] band bg-ink px-5 py-4">
          <div>
            <h2 id="help-title" className="eyebrow text-paper">
              How Walkup works
            </h2>
            <p className="mt-1.5 text-[13px] text-ondark-mute">The short version. The full walkthrough is below.</p>
          </div>
          <button
            type="button"
            onClick={() => helpRef.current?.close()}
            aria-label="Close"
            className="rounded-md p-1 text-ondark-mute hover:bg-ink-mid hover:text-paper"
          >
            <X size={16} strokeWidth={1.6} aria-hidden="true" />
          </button>
        </div>
        <ul className="space-y-3 px-5 py-5">
          {HELP.map((h) => (
            <li key={h.title}>
              <div className="text-[13px] font-semibold text-ink">{h.title}</div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-mute">{h.body}</p>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
          <a
            href="/walkthrough.txt"
            download="Walkup walkthrough.txt"
            className="text-[13px] font-medium text-ink underline underline-offset-2"
          >
            Download the full walkthrough
          </a>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                helpRef.current?.close();
                window.dispatchEvent(new Event(START_TOUR_EVENT));
              }}
              className="rounded-md border border-line-strong px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-fill"
            >
              Take the tour
            </button>
            <button
              type="button"
              onClick={() => helpRef.current?.close()}
              className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid"
            >
              Got it
            </button>
          </div>
        </div>
      </dialog>
    </header>
  );
}
