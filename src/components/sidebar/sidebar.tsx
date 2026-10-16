"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { WalkupMark } from "@/components/mark";
import { ThemeToggle } from "./theme-toggle";
import { isNavItemActive, navFor, type NavItemConfig, type NavRole } from "./config";
import { primeServerMode, setDrawerOpen, setSidebarMode, useSidebarState, type SidebarMode } from "./sidebar-state";

/** Badge colour by what it counts: rust for bank work waiting, gold for repairs to look at. */
const BADGE_TONE: Record<string, { number: string; dot: string }> = {
  uncategorized: { number: "bg-rust text-paper", dot: "bg-rust" },
  repairs: { number: "bg-brass text-on-brass", dot: "bg-brass" },
  announcements: { number: "bg-brass text-on-brass", dot: "bg-brass" },
};

/** How long the content takes to fade out before the layout swaps. */
const FADE_OUT_MS = 180;
/** How long the mouse rests on the rail before it slides open, so passing over it doesn't flash it. */
const PEEK_DELAY_MS = 140;

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

/**
 * One nav item in either state. In the rail the label is visually hidden
 * but stays in the DOM as the accessible name; a tooltip (role="tooltip",
 * aria-describedby) repeats it on hover and focus, with the badge count as
 * words. The badge is a number in the expanded state and an 8px dot in the
 * rail; both read the same count.
 */
function NavItemLink({
  item,
  active,
  badgeCount,
  expanded,
}: {
  item: NavItemConfig;
  active: boolean;
  badgeCount?: number;
  expanded: boolean;
}) {
  const Icon = item.icon;
  const tone = BADGE_TONE[item.badgeKey ?? ""] ?? BADGE_TONE.uncategorized;
  const count = typeof badgeCount === "number" && badgeCount > 0 ? badgeCount : 0;
  const countWords = count > 0 ? `${count > 99 ? "99+" : count} waiting` : "";

  if (expanded) {
    return (
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        data-tour={item.tourId}
        className={`relative flex min-h-[40px] items-center gap-2.5 rounded-md border-l-[3px] px-2.5 text-[13px] font-bold transition-colors duration-300 ease-out ${
          active
            ? "border-brass bg-nav-active text-nav-active-text"
            : item.featured
              ? "border-brass/60 bg-warning-tint text-warning-text hover:brightness-95"
              : "border-transparent text-nav-muted hover:bg-nav-hover hover:text-nav-text"
        }`}
      >
        <Icon size={16} strokeWidth={1.6} className={active ? "text-brass" : "text-current"} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {count > 0 ? (
          <>
            <span
              aria-hidden="true"
              className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-medium leading-none ${tone.number}`}
            >
              {count > 99 ? "99+" : count}
            </span>
            <span className="sr-only">, {countWords}</span>
          </>
        ) : null}
      </Link>
    );
  }

  return (
    <div className="relative">
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        data-tour={item.tourId}
        className={`relative mx-auto flex h-11 w-11 items-center justify-center rounded-lg transition-colors duration-300 ease-out ${
          active
            ? "bg-nav-active text-nav-active-text"
            : item.featured
              ? "bg-warning-tint text-warning-text hover:brightness-95"
              : "text-nav-muted hover:bg-nav-hover hover:text-nav-text"
        }`}
      >
        {/* The "where am I" cue: a 3px gold bar on the rail's left edge, level with the active item. */}
        {active ? <span aria-hidden="true" className="absolute -left-[14px] bottom-1 top-1 w-[3px] rounded-r bg-brass" /> : null}
        <span className="relative">
          <Icon size={18} strokeWidth={1.6} className={active ? "text-brass" : "text-current"} aria-hidden="true" />
          {count > 0 ? <span aria-hidden="true" className={`absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full ${tone.dot}`} /> : null}
        </span>
        <span className="sr-only">
          {item.label}
          {count > 0 ? `, ${countWords}` : ""}
        </span>
      </Link>
    </div>
  );
}

export function Sidebar({
  associationName,
  uncategorizedCount,
  repairsCount = 0,
  announcementsCount = 0,
  role = null,
  userEmail,
  initialMode = "expanded",
}: {
  associationName: string | null;
  uncategorizedCount: number;
  /** Repairs to look at (layout.tsx, repairs-spec §18.6); 0 for anyone with nothing new. */
  repairsCount?: number;
  /** Announcements the viewer has not opened (owner-portal-spec 7.2); 0 for anyone with nothing new. */
  announcementsCount?: number;
  /** A board member or accountant who also owns a unit gets a "My unit" item. */
  /** The viewer's highest role, for the role-dependent labels. */
  role?: NavRole | null;
  userEmail: string;
  /** From the walkup.sidebar cookie, so the first paint already matches. */
  initialMode?: SidebarMode;
}) {
  primeServerMode(initialMode);
  const pathname = usePathname();
  const state = useSidebarState();
  const { expanded: pinned, phone, narrow, drawerOpen } = state;

  // Hover-to-peek: the moment the mouse touches the icon rail it slides out
  // over the page (the content doesn't move) so the labels can be read;
  // leaving slides it back. The pinned state — what [ ] and the toggle set —
  // is unchanged.
  const [peek, setPeek] = useState(false);
  const canPeek = !pinned && !narrow && !phone;
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPeek = () => {
    if (!canPeek) return;
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(true), PEEK_DELAY_MS);
  };
  const endPeek = () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = null;
    setPeek(false);
  };
  useEffect(() => () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
  }, []);
  // Where the sidebar is heading: the labeled sidebar when pinned open or peeking.
  const wantOpen = pinned || (peek && canPeek);
  // What's drawn lags it by a beat, so the content can fade out while the
  // width starts to move and fade back in as it arrives — a crossfade rather
  // than icons snapping into labels. (Derived, not stored: crossfading is
  // simply "drawn differs from wanted", which the timer below resolves.)
  const [drawnOpen, setDrawnOpen] = useState(wantOpen);
  useEffect(() => {
    if (drawnOpen === wantOpen) return;
    const t = setTimeout(() => setDrawnOpen(wantOpen), FADE_OUT_MS);
    return () => clearTimeout(t);
  }, [drawnOpen, wantOpen]);
  const expanded = drawnOpen;
  const crossfading = drawnOpen !== wantOpen;
  const fade = `transition-opacity motion-reduce:transition-none ${
    crossfading ? "opacity-0 duration-[180ms] ease-in" : "opacity-100 duration-[340ms] ease-out"
  }`;

  // [ collapses, ] expands — never while typing, never when the viewport forces the rail.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === "Escape") {
        setDrawerOpen(false);
        const el = document.activeElement;
        if (el instanceof HTMLElement && el.closest("nav[aria-label='Main']")) el.blur(); // closes an open tooltip
        return;
      }
      if (window.matchMedia("(max-width: 1023px)").matches) return;
      if (e.key === "[") setSidebarMode("rail");
      if (e.key === "]") setSidebarMode("expanded");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the drawer after navigating.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const badges = { uncategorized: uncategorizedCount, repairs: repairsCount, announcements: announcementsCount };
  const nav = navFor(role);
  const navGroups = nav.groups;
  const initials = userEmail.slice(0, 2).toUpperCase();
  const toggle = () => setSidebarMode(state.mode === "expanded" ? "rail" : "expanded");
  const badgeFor = (item: NavItemConfig) => (item.badgeKey ? badges[item.badgeKey as keyof typeof badges] : undefined);

  const divider = <div aria-hidden="true" className="mx-1 my-2.5 border-t border-nav-divider" />;

  return (
    <>
      {phone && drawerOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-30 bg-ink-deep/40"
        />
      ) : null}
      <nav
        aria-label="Main"
        data-expanded={expanded ? "true" : "false"}
        onMouseEnter={startPeek}
        onMouseLeave={endPeek}
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r-[0.5px] border-nav-divider/70 bg-nav transition-[width,box-shadow] duration-[480ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none ${
          phone && !drawerOpen ? "invisible w-0" : wantOpen ? "w-[288px]" : "w-[72px]"
        } ${!pinned && (drawnOpen || wantOpen) ? "overflow-hidden" : ""} ${wantOpen && !pinned ? "shadow-xl" : ""}`}
      >
        {/* The logo band: same height and colour as the page header, so the two
            read as one bar across the top. It collapses with the sidebar. Its
            navy never fades — only what's on it does — so no white shows
            through while the sidebar slides. */}
        <div className="relative -mr-px h-[56px] shrink-0 band bg-ink text-paper">
        <div className={`flex h-full items-center ${expanded ? "gap-3 px-4" : "justify-center"} ${fade}`}>
          <Link href="/" aria-label="Walkup home" className="flex min-w-0 items-center gap-3">
            <WalkupMark variant="tile" size={32} className="shrink-0" title={expanded ? "" : "Walkup"} />
            {expanded ? (
              <span className="flex min-w-0 flex-col leading-none">
                <span className="wordmark text-[20px] text-bone">Walkup</span>
                {associationName ? <span className="mt-1 truncate text-[11px] font-normal text-ondark-mute">{associationName}</span> : null}
              </span>
            ) : null}
          </Link>
          {phone && drawerOpen ? (
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close navigation"
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-ondark-mute hover:bg-ink-mid hover:text-paper"
            >
              <X size={16} strokeWidth={1.6} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        </div>

        <div className={`flex min-h-0 flex-1 flex-col ${fade}`}>
        <div className={`flex-1 overflow-y-auto pb-4 pt-2 ${expanded ? "px-3" : "px-[14px]"}`}>
          <div className="space-y-0.5">
            {nav.ungrouped.map((item) => (
              <NavItemLink key={item.href} item={item} active={isNavItemActive(pathname, item)} badgeCount={badgeFor(item)} expanded={expanded} />
            ))}
          </div>

          {navGroups.map((group) => (
            <div key={group.label}>
              {divider}
              {expanded ? (
                <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-section-label">{group.label}</div>
              ) : null}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavItemLink key={item.href} item={item} active={isNavItemActive(pathname, item)} badgeCount={badgeFor(item)} expanded={expanded} />
                ))}
              </div>
            </div>
          ))}

          {nav.trailing.length > 0 ? (
            <div className="space-y-0.5">
              {divider}
              {nav.trailing.map((item) => (
                <NavItemLink key={item.href} item={item} active={isNavItemActive(pathname, item)} badgeCount={badgeFor(item)} expanded={expanded} />
              ))}
            </div>
          ) : null}
        </div>

        {!narrow ? (
          <div className={`border-t border-nav-divider pt-2 ${expanded ? "px-3" : ""}`}>
          <button
            type="button"
            onClick={toggle}
            aria-label={pinned ? "Collapse navigation" : "Expand navigation"}
            aria-expanded={pinned}
            title={pinned ? "Collapse navigation  ( [ )" : "Keep navigation open  ( ] )"}
            className={`mb-2 flex items-center text-nav-muted transition-colors duration-300 hover:bg-nav-hover hover:text-nav-text ${
              expanded
                ? "min-h-[40px] w-full gap-2.5 rounded-md border-l-[3px] border-transparent px-2.5 text-[13px] font-bold"
                : "mx-auto h-11 w-11 justify-center rounded-lg"
            }`}
          >
            {expanded ? (
              <>
                {pinned ? (
                  <PanelLeftClose size={16} strokeWidth={1.6} aria-hidden="true" />
                ) : (
                  <PanelLeftOpen size={16} strokeWidth={1.6} aria-hidden="true" />
                )}
                <span>{pinned ? "Collapse" : "Keep open"}</span>
              </>
            ) : (
              <PanelLeftOpen size={18} strokeWidth={1.6} aria-hidden="true" />
            )}
          </button>
          </div>
        ) : null}

        <div className={`flex items-center border-t border-nav-divider ${expanded ? "gap-2.5 px-3 py-3" : "flex-col gap-2 py-3"}`}>
          <Link
            href="/account"
            title="Your account"
            className={`flex min-w-0 items-center gap-2.5 rounded-md hover:text-nav-text ${expanded ? "flex-1 -mx-1 px-1 py-0.5 hover:bg-nav-hover" : ""}`}
          >
            <span
              aria-hidden="true"
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-slate text-[10px] font-medium text-paper"
            >
              {initials}
            </span>
            {expanded ? (
              <span className="min-w-0 flex-1 truncate text-[12px] text-nav-muted">{userEmail}</span>
            ) : (
              <span className="sr-only">Your account</span>
            )}
          </Link>
          <ThemeToggle className={expanded ? "ml-auto" : ""} />
        </div>
        </div>
      </nav>
    </>
  );
}
