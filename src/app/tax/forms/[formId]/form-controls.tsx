"use client";

import { useActionState, useState, useTransition } from "react";
import { markFormFiled, refreshFromRecords } from "../../form-actions";

const btn = "inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill disabled:opacity-50";

/**
 * Refill the form from the records for its own year. Without a PDF template
 * (none, or a link-only one) there are no lines to fill, but the due date
 * and determination still come back in step with the Taxes tab — and this is
 * how a form picks up a template a platform admin has since checked.
 */
export function RefreshButton({ formId }: { formId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await refreshFromRecords(formId);
            setMsg(
              r.error ??
                (r.noTemplate
                  ? "Due date and determination refreshed. Walkup hasn’t checked this year’s official form yet, so there are no lines to fill."
                  : "Refreshed from your records."),
            );
          })
        }
        className={btn}
      >
        {pending ? "Refreshing…" : "Refresh from your records"}
      </button>
      {msg ? <span className="text-[11px] text-mute">{msg}</span> : null}
    </span>
  );
}

/**
 * "Mark as filed" — the date and, optionally, proof. The action decides
 * whether the form may be marked (every line confirmed, or nothing to confirm
 * in Walkup); the label says which of those this is.
 */
export function MarkFiled({ formId, label = "Mark as filed" }: { formId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(markFormFiled, null);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={btn}>
        {label}
      </button>
    );
  }
  return (
    <form action={action} className="w-full space-y-3 rounded-lg border border-line p-4">
      <input type="hidden" name="form_id" value={formId} />
      <p className="text-[12px] text-mute">
        Walkup records the date; it doesn&rsquo;t file anything. For a 1120-H this also saves and locks the year&rsquo;s figures.
      </p>
      <div>
        <label htmlFor="filed_on" className="block text-[12px] font-medium text-ink">Filed on</label>
        <input id="filed_on" name="filed_on" type="date" required className="mt-1 rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink" />
      </div>
      <div>
        <label htmlFor="proof" className="block text-[12px] font-medium text-ink">
          Proof <span className="font-normal text-mute-soft">optional — a mailing receipt, the portal&rsquo;s confirmation or your CPA&rsquo;s</span>
        </label>
        <input id="proof" name="proof" type="file" accept="application/pdf,image/*" className="mt-1 text-[12px]" />
      </div>
      {state?.error ? <p className="text-[12px] text-bad-text">{state.error}</p> : null}
      {state?.ok ? <p className="text-[12px] text-good-text">Recorded as filed.</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="min-h-[44px] rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50">
          {pending ? "Saving…" : "Record it"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={btn}>
          Cancel
        </button>
      </div>
    </form>
  );
}
