"use client";

import { createPortal } from "react-dom";
import { useMounted, useSidebarState } from "./sidebar-state";
import { TOP_BAR_SLOT_ID } from "./top-bar";

/**
 * Renders its children in place when the labeled sidebar is expanded, and
 * moves them into the slim top bar when the rail is showing. Used by Home's
 * greeting row for the "Books balance" pill.
 */
export function TopBarSlot({ children }: { children: React.ReactNode }) {
  const mounted = useMounted();
  const { topBar } = useSidebarState();
  if (!mounted || !topBar) return <>{children}</>;
  const target = document.getElementById(TOP_BAR_SLOT_ID);
  return target ? createPortal(children, target) : <>{children}</>;
}
