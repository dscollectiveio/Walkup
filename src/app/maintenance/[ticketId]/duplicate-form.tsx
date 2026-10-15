"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markDuplicate } from "@/app/maintenance/actions";
import { Card } from "@/components/ui";
import { btnSecondary, errorClass, inputClass, labelClass } from "@/components/repairs/styles";

/** "Mark as a duplicate" (repairs-spec §5.9): closes this one and points at the original. */
export function DuplicateForm({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const id = useId();
  const [ref, setRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card title="Mark as a duplicate">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const r = await markDuplicate(ticketId, Number(ref.replace(/^#/, "").trim()));
            if ("error" in r) setError(r.error);
            else router.refresh();
          });
        }}
      >
        <div className="sm:w-40">
          <label htmlFor={id} className={labelClass}>
            Same problem as #
          </label>
          <input id={id} inputMode="numeric" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="12" className={inputClass} />
        </div>
        <button type="submit" disabled={pending || !ref.trim()} className={btnSecondary}>
          {pending ? "Saving…" : "Close as duplicate"}
        </button>
      </form>
      {error ? <p className={`mt-2 ${errorClass}`}>{error}</p> : null}
    </Card>
  );
}
