"use client";

/**
 * Previously moved Home's "Books balance" pill into the slim top bar in the
 * rail state. The header is now on every page and carries the user's name,
 * Help and Sign out, so the pill stays in the greeting row. Kept as a
 * pass-through so callers don't change.
 */
export function TopBarSlot({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
