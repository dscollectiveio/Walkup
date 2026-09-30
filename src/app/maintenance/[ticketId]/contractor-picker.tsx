"use client";

import { useState, useTransition } from "react";
import { assignTicketContractor } from "@/app/contractors/vendor-actions";

export function ContractorPicker({
  ticketId,
  currentVendorId,
  contractors,
}: {
  ticketId: string;
  currentVendorId: string | null;
  contractors: { id: string; name: string; doNotUse: boolean }[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <label htmlFor={`contractor-${ticketId}`} className="block text-[12px] font-medium text-ink">
        Contractor
      </label>
      <select
        id={`contractor-${ticketId}`}
        defaultValue={currentVendorId ?? ""}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            setError(null);
            const r = await assignTicketContractor(ticketId, e.target.value || null);
            if (r.error) setError(r.error);
          })
        }
        className="mt-1 min-h-[44px] w-full max-w-sm rounded-lg border border-line-strong bg-paper px-3 text-[13px] text-ink disabled:opacity-50"
      >
        <option value="">Nobody yet</option>
        {contractors.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.doNotUse ? " (do not use)" : ""}
          </option>
        ))}
      </select>
      {error ? <p className="mt-1 text-[12px] text-bad-text">{error}</p> : null}
    </div>
  );
}
