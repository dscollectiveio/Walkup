"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTicketPlan } from "@/app/maintenance/actions";
import { btnSecondary, errorClass } from "@/components/repairs/styles";

/** "Assign to #{ref}" on a saved contractor's card (repairs-spec §9.1 item 4). */
export function AssignButton(props: { ticketId: string; reference: number; vendorId: string; assigned: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (props.assigned || done) {
    return <span className="inline-flex min-h-[44px] items-center text-[13px] text-good-text">Assigned to #{props.reference}</span>;
  }
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={pending}
        className={btnSecondary}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await setTicketPlan(props.ticketId, { assigned_vendor_id: props.vendorId });
            if ("error" in r) setError(r.error);
            else {
              setDone(true);
              router.refresh();
            }
          })
        }
      >
        {pending ? "Assigning…" : `Assign to #${props.reference}`}
      </button>
      {error ? <span className={errorClass}>{error}</span> : null}
    </span>
  );
}
