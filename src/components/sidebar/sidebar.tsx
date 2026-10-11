"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { Mark } from "@/components/mark";
import { ThemeToggle } from "./theme-toggle";
import { NAV_GROUPS, TRAILING_NAV, UNGROUPED_NAV, type NavItemConfig } from "./config";
import { primeServerMode, setDrawerOpen, setSidebarMode, useSidebarState, type SidebarMode } from "./sidebar-state";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** How long the mouse rests on the rail before it slides out. */
const PEEK_DELAY_MS = 500;

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
  const tipId = useId();
  const count = typeof badgeCount === "number" && badgeCount > 0 ? badgeCount : 0;
  const countWords = count > 0 ? `${count > 99 ? "99+" : count} waiting` : "";

  if (expanded) {
    return (
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={`relative flex min-h-[40px] items-center gap-2.5 rounded-md border-l-[3px] px-2.5 text-[13px] font-bold transition-colors ${
          active
            ? "border-brass bg-nav-active text-nav-active-text"
            : "border-transparent text-nav-muted hover:bg-nav-hover hover:text-nav-text"
        }`}
      >
        <Icon size={16} strokeWidth={1.6} className={active ? "text-brass" : "text-current"} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {count > 0 ? (
          <>
            <span
              aria-hidden="true"
              className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rust px-1 text-[9px] font-medium leading-none text-paper"
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
    <div className="group relative">
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        aria-describedby={tipId}
        className={`relative mx-auto flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
          active ? "bg-nav-active text-nav-active-text" : "text-nav-muted hover:bg-nav-hover hover:text-nav-text"
        }`}
      >
        {/* The "where am I" cue: a 3px gold bar on the rail's left edge, level with the active item. */}
        {active ? <span aria-hidden="true" className="absolute -left-[14px] bottom-1 top-1 w-[3px] rounded-r bg-brass" /> : null}
        <span className="relative">
          <Icon size={18} strokeWidth={1.6} className={active ? "text-brass" : "text-current"} aria-hidden="true" />
          {count > 0 ? <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-rust" /> : null}
        </span>
        <span className="sr-only">
          {item.label}
          {count > 0 ? `, ${countWords}` : ""}
        </span>
      </Link>
      <span
        role="tooltip"
        id={tipId}
        className="pointer-events-none fixed z-50 ml-[60px] -mt-9 whitespace-nowrap rounded-md border border-line bg-paper px-2.5 py-1.5 text-[12.5px] text-ink opacity-0 shadow transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
      >
        {item.label}
        {count > 0 ? <span className="text-mute">, {countWords}</span> : null}
      </span>
    </div>
  );
}

export function Sidebar({
  associationName,
  uncategorizedCount,
  userEmail,
  initialMode = "expanded",
}: {
  associationName: string | null;
  uncategorizedCount: number;
  userEmail: string;
  /** From the walkup.sidebar cookie, so the first paint already matches. */
  initialMode?: SidebarMode;
}) {
  primeServerMode(initialMode);
  const pathname = usePathname();
  const state = useSidebarState();
  const { expanded: pinned, phone, narrow, drawerOpen } = state;

  // Hover-to-peek: resting the mouse on the icon rail for a second slides it
  // out over the page (the content doesn't move) so the labels can be read;
  // leaving slides it back. The pinned state — what [ ] and the toggle set —
  // is unchanged.
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canPeek = !pinned && !narrow && !phone;
  const startPeek = () => {
    if (!canPeek || peekTimer.current) return;
    peekTimer.current = setTimeout(() => {
      peekTimer.current = null;
      setPeek(true);
    }, PEEK_DELAY_MS);
  };
  const endPeek = () => {
    if (peekTimer.current) {
      clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
    setPeek(false);
  };
  useEffect(() => () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
  }, []);
  // What's drawn: the labeled sidebar when pinned open or peeking.
  const expanded = pinned || (peek && canPeek);

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

  const badges = { uncategorized: uncategorizedCount };
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
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-nav-divider bg-nav transition-[width,box-shadow] duration-[220ms] ease-out motion-reduce:transition-none ${
          phone && !drawerOpen ? "invisible w-0" : expanded ? "w-[288px]" : "w-[72px]"
        } ${expanded && !pinned ? "overflow-hidden shadow-xl" : ""}`}
      >
        {/* The logo band: same height and colour as the page header, so the two
            read as one bar across the top. It collapses with the sidebar. */}
        <div className={`relative -mr-px flex h-[56px] shrink-0 items-center bg-ink text-paper ${expanded ? "gap-3 px-4" : "justify-center"}`}>
          <Link href="/" aria-label="Walkup home" className="flex min-w-0 items-center gap-3">
            <Mark variant="dark" size={30} className="shrink-0" />
            {expanded ? (
              <span className="flex min-w-0 flex-col leading-none">
                <span className="text-[15px] font-semibold tracking-[-0.014em] text-paper">Walkup</span>
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

        <div className={`flex-1 overflow-y-auto pb-4 pt-2 ${expanded ? "px-3" : "px-[14px]"}`}>
          <div className="space-y-0.5">
            {UNGROUPED_NAV.map((item) => (
              <NavItemLink key={item.href} item={item} active={isActive(pathname, item.href)} badgeCount={badgeFor(item)} expanded={expanded} />
            ))}
          </div>

          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              {divider}
              {expanded ? (
                <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.07em] text-section-label">{group.label}</div>
              ) : null}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavItemLink key={item.href} item={item} active={isActive(pathname, item.href)} badgeCount={badgeFor(item)} expanded={expanded} />
                ))}
              </div>
            </div>
          ))}

          <div className="space-y-0.5">
            {divider}
            {TRAILING_NAV.map((item) => (
              <NavItemLink key={item.href} item={item} active={isActive(pathname, item.href)} badgeCount={badgeFor(item)} expanded={expanded} />
            ))}
          </div>
        </div>

        {!narrow ? (
          <button
            type="button"
            onClick={toggle}
            aria-label={pinned ? "Collapse navigation" : "Expand navigation"}
            aria-expanded={pinned}
            title={pinned ? "Collapse navigation  ( [ )" : "Keep navigation open  ( ] )"}
            className={`mb-2 flex items-center text-[12px] text-nav-muted transition-colors hover:bg-nav-hover hover:text-nav-text ${
              expanded ? "mx-3 gap-3 rounded-md px-3 py-2" : "mx-auto h-11 w-11 justify-center rounded-lg"
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
        ) : null}

        <div className={`flex items-center border-t border-nav-divider ${expanded ? "gap-2.5 px-3 py-3" : "flex-col gap-2 py-3"}`}>
          <span
            aria-hidden="true"
            title={userEmail}
            className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-slate text-[10px] font-medium text-paper"
          >
            {initials}
          </span>
          {expanded ? <span className="min-w-0 flex-1 truncate text-[12px] text-nav-muted">{userEmail}</span> : null}
          <ThemeToggle className={expanded ? "ml-auto" : ""} />
        </div>
      </nav>
    </>
  );
}
