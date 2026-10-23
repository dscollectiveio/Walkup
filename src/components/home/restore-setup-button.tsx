"use client";

import { useState, useTransition } from "react";
import { restoreSetupGuide } from "@/app/home-actions";

/** "Show setup guide": undoes "Skip for now". Sits in the to-do card's header while the guide is hidden. */
export function RestoreSetupButton() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex shrink-0 flex-col items-end gap-0.5">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await restoreSetupGuide();
            if (result.error) setError(result.error);
          })
        }
        className="inline-flex min-h-[28px] items-center rounded-md border border-paper/30 px-3 text-[12px] font-medium text-paper hover:bg-paper/10 disabled:opacity-50"
      >
        {pending ? "Bringing it back…" : "Show setup guide"}
      </button>
      {error ? <span className="text-[11px] text-ondark-mute">{error}</span> : null}
    </span>
  );
}
