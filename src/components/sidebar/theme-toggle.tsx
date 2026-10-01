"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

const KEY = "walkup.theme";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
const isDark = () => document.documentElement.dataset.theme === "dark";
const serverIsDark = () => false;

/**
 * Light/Dark. A saved choice wins; otherwise the system preference. The
 * inline script in layout.tsx applies the same rule before first paint, so
 * this only reads what's already on <html> and flips it.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const dark = useSyncExternalStore(subscribe, isDark, serverIsDark);

  function toggle() {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode: the choice just doesn't persist */
    }
  }

  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-nav-muted transition-colors hover:bg-nav-hover hover:text-nav-text ${className}`}
    >
      {dark ? <Sun size={15} strokeWidth={1.6} aria-hidden="true" /> : <Moon size={15} strokeWidth={1.6} aria-hidden="true" />}
    </button>
  );
}
