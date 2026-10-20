"use client";

import { useState, useTransition } from "react";
import { extendAccountantAccess } from "@/app/building/actions";

/** Another 90 days from today (also brings back access the daily clean-up just ended). Board admin only. */
export function ExtendAccessButton({ personId }: { personId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await extendAccountantAccess(personId);
            if (r.error) setError(r.error);
          })
        }
        className="text-[12px] font-medium text-ink underline underline-offset-2 hover:no-underline disabled:opacity-50"
      >
        {pending ? "Saving…" : "Extend 90 days"}
      </button>
      {error ? <span className="text-[11px] text-bad-text">{error}</span> : null}
    </span>
  );
}
