"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markEmergency } from "@/app/maintenance/actions";
import { errorClass } from "@/components/repairs/styles";

/** The board's "Not an emergency" under the safety banner (repairs-spec §5.3 card 2). Leaves the urgency as it is. */
export function NotAnEmergency({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await markEmergency(ticketId, null);
            if ("error" in r) setError(r.error);
            else router.refresh();
          })
        }
        className="min-h-[44px] text-[13px] font-medium underline underline-offset-2"
      >
        {pending ? "Saving…" : "Not an emergency"}
      </button>
      {error ? <p className={errorClass}>{error}</p> : null}
    </div>
  );
}
