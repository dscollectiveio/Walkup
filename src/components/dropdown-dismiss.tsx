"use client";

import { useEffect } from "react";

/**
 * Closes any open <details> dropdown menu when you click or tap outside it, or press Escape.
 * A <details> counts as a menu when its panel floats (position absolute or fixed); ordinary
 * expand/collapse sections (accordions) are left alone. Mounted once, so every menu in the app behaves the same.
 */
export function DropdownDismiss() {
  useEffect(() => {
    const isMenu = (d: HTMLDetailsElement) => {
      const panel = Array.from(d.children).find((c) => c.tagName !== "SUMMARY");
      if (!panel) return false;
      const pos = getComputedStyle(panel).position;
      return pos === "absolute" || pos === "fixed";
    };
    const closeMenus = (except?: Node | null) => {
      document.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((d) => {
        if (except && d.contains(except)) return;
        if (isMenu(d)) d.open = false;
      });
    };
    const onPointer = (e: PointerEvent) => closeMenus(e.target as Node);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenus();
    };
    // Choosing something inside a menu closes it, like any menu.
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      const link = t?.closest("a, button");
      const d = link?.closest("details");
      if (d && d.open && link && link.tagName !== "SUMMARY" && !link.closest("summary") && isMenu(d)) d.open = false;
    };
    document.addEventListener("click", onClick);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return null;
}
