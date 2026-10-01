"use client";

import { useSyncExternalStore } from "react";

/**
 * One source of truth for the navigation's state, shared by the sidebar,
 * the slim top bar and anything that moves between them (Home's status
 * pill). The *preference* lives on <html data-sidebar> ("expanded" | "rail"),
 * written to the `walkup.sidebar` cookie so the server renders the right
 * width before first paint. The *effective* state also depends on the
 * viewport: under 1024px the rail is forced, under 768px the nav is a
 * drawer (<html data-drawer="open">).
 */
export type SidebarMode = "expanded" | "rail";

export interface SidebarState {
  mode: SidebarMode;
  /** Viewport under 1024px: rail forced, toggle hidden. */
  narrow: boolean;
  /** Viewport under 768px: nav is a slide-over drawer. */
  phone: boolean;
  drawerOpen: boolean;
  /** What is actually showing: the labeled sidebar or the icon rail. */
  expanded: boolean;
  /** Whether the slim top bar is on screen. */
  topBar: boolean;
}

export const SIDEBAR_COOKIE = "walkup.sidebar";
const STORAGE_KEY = "walkup.sidebar";

const NARROW = "(max-width: 1023px)";
const PHONE = "(max-width: 767px)";

let serverMode: SidebarMode = "expanded";
/** Called once by the Sidebar with the cookie's value so server and first client render agree. */
export function primeServerMode(mode: SidebarMode) {
  serverMode = mode;
}

function read(): SidebarState {
  const root = document.documentElement;
  const mode: SidebarMode = root.dataset.sidebar === "rail" ? "rail" : "expanded";
  const narrow = window.matchMedia(NARROW).matches;
  const phone = window.matchMedia(PHONE).matches;
  const drawerOpen = root.dataset.drawer === "open";
  const expanded = phone ? drawerOpen : narrow ? false : mode === "expanded";
  const topBar = phone || narrow || mode === "rail";
  return { mode, narrow, phone, drawerOpen, expanded, topBar };
}

let cached: SidebarState | null = null;
function snapshot(): SidebarState {
  const next = read();
  if (
    cached &&
    cached.mode === next.mode &&
    cached.narrow === next.narrow &&
    cached.phone === next.phone &&
    cached.drawerOpen === next.drawerOpen
  ) {
    return cached;
  }
  cached = next;
  return next;
}

const serverSnapshots: Record<SidebarMode, SidebarState> = {
  expanded: { mode: "expanded", narrow: false, phone: false, drawerOpen: false, expanded: true, topBar: false },
  rail: { mode: "rail", narrow: false, phone: false, drawerOpen: false, expanded: false, topBar: true },
};
const serverSnapshot = () => serverSnapshots[serverMode];

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-sidebar", "data-drawer"] });
  const n = window.matchMedia(NARROW);
  const p = window.matchMedia(PHONE);
  n.addEventListener("change", onChange);
  p.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    n.removeEventListener("change", onChange);
    p.removeEventListener("change", onChange);
  };
}

export function useSidebarState(): SidebarState {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

export function setSidebarMode(mode: SidebarMode) {
  document.documentElement.dataset.sidebar = mode;
  document.cookie = `${SIDEBAR_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax`;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode */
  }
}

export function setDrawerOpen(open: boolean) {
  if (open) document.documentElement.dataset.drawer = "open";
  else delete document.documentElement.dataset.drawer;
}

/** True once hydrated — lets a component portal somewhere without a server mismatch. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
