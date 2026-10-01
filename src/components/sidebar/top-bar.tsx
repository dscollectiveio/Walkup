"use client";

import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { pageTitleFor } from "./config";
import { setDrawerOpen, useSidebarState } from "./sidebar-state";

export const TOP_BAR_SLOT_ID = "walkup-topbar-slot";

/**
 * The slim top bar that carries the building name and current page while
 * the rail is showing (or on a phone). Not rendered when the labeled
 * sidebar is expanded — the sidebar's own lockup says the same thing.
 */
export function TopBar({ associationName, userEmail }: { associationName: string | null; userEmail: string }) {
  const pathname = usePathname();
  const { topBar, phone } = useSidebarState();
  if (!topBar) return null;
  const page = pageTitleFor(pathname);

  return (
    <header className="sticky top-0 z-20 flex h-[52px] items-center gap-3 border-b border-line bg-paper px-4 min-[900px]:px-6">
      {phone ? (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          className="-ml-1 flex h-9 w-9 items-center justify-center rounded-md text-ink hover:bg-fill"
        >
          <Menu size={18} strokeWidth={1.6} aria-hidden="true" />
        </button>
      ) : null}
      <div className="flex min-w-0 items-baseline gap-2 text-[15px]">
        <span className="truncate font-semibold text-ink">{associationName ?? "Walkup"}</span>
        {page ? (
          <>
            <span aria-hidden="true" className="text-mute">
              ·
            </span>
            <span className="truncate text-[13px] text-mute">{page}</span>
          </>
        ) : null}
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-3">
        <div id={TOP_BAR_SLOT_ID} className="flex items-center" />
        <span className="hidden truncate text-[12.5px] text-mute sm:inline">{userEmail}</span>
      </div>
    </header>
  );
}
