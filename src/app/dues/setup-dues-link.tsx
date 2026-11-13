"use client";

import { SETUP_DUES_EVENT } from "./setup-dues-event";

/** "Set up dues" under the stats: opens the first unit without dues, with the plan form showing. */
export function SetupDuesLink({ unitId }: { unitId: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        document.getElementById(`unit-${unitId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        window.dispatchEvent(new CustomEvent(SETUP_DUES_EVENT, { detail: unitId }));
      }}
      className="inline-flex min-h-[44px] items-center font-medium text-ink underline underline-offset-2 sm:min-h-0"
    >
      Set up dues
    </button>
  );
}
