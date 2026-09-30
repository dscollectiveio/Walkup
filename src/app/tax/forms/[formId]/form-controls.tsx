"use client";

import { useActionState, useState, useTransition } from "react";
import { markFormFiled, refreshFromRecords } from "../../form-actions";

const btn = "inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill disabled:opacity-50";

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
            setMsg(r.error ?? (r.noTemplate ? "The form still isn't ready in Walkup." : "Refreshed from your records."));
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

export function MarkFiled({ formId }: { formId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(markFormFiled, null);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={btn}>
        Mark as filed
      </button>
    );
  }
  return (
    <form action={action} className="space-y-3 rounded-lg border border-line p-4">
      <input type="hidden" name="form_id" value={formId} />
      <div>
        <label htmlFor="filed_on" className="block text-[12px] font-medium text-ink">Filed on</label>
        <input id="filed_on" name="filed_on" type="date" required className="mt-1 rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink" />
      </div>
      <div>
        <label htmlFor="proof" className="block text-[12px] font-medium text-ink">
          Proof <span className="font-normal text-mute-soft">optional — a mailing receipt or your CPA&rsquo;s confirmation</span>
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
