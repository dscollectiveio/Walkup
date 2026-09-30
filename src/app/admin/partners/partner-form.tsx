"use client";

import { useActionState, useState } from "react";
import { savePartner } from "@/app/insurance/actions";

const inputClass = "mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink";

export function PartnerForm({
  partner,
}: {
  partner: { id: string; name: string; contact_email: string; phone: string | null; states_served: string[]; active: boolean; notes: string | null } | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(savePartner, null);
  const [prev, setPrev] = useState(state);
  if (state !== prev) {
    setPrev(state);
    if (state?.ok) setOpen(false);
  }
  const key = partner?.id ?? "new";

  if (!open) {
    return partner ? (
      <div className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
        <div>
          <span className="font-medium text-ink">{partner.name}</span>
          <span className="ml-2 text-mute">
            {partner.contact_email} · {partner.states_served.join(", ")}
          </span>
          {!partner.active ? <span className="ml-2 text-[11px] text-mute-soft">inactive</span> : null}
        </div>
        <button type="button" onClick={() => setOpen(true)} className="text-[12px] text-mute underline underline-offset-2">
          Edit
        </button>
      </div>
    ) : (
      <button type="button" onClick={() => setOpen(true)} className="min-h-[44px] rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid">
        Add a partner
      </button>
    );
  }

  return (
    <form action={action} className="space-y-3">
      {partner ? <input type="hidden" name="id" value={partner.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`pn-${key}`} className="block text-[12px] font-medium text-ink">Broker name</label>
          <input id={`pn-${key}`} name="name" required defaultValue={partner?.name ?? ""} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`pe-${key}`} className="block text-[12px] font-medium text-ink">Email for quote requests</label>
          <input id={`pe-${key}`} name="contact_email" type="email" required defaultValue={partner?.contact_email ?? ""} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`pp-${key}`} className="block text-[12px] font-medium text-ink">Phone</label>
          <input id={`pp-${key}`} name="phone" defaultValue={partner?.phone ?? ""} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`ps-${key}`} className="block text-[12px] font-medium text-ink">States served</label>
          <input id={`ps-${key}`} name="states_served" required placeholder="IL, WI" defaultValue={partner?.states_served.join(", ") ?? ""} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`pt-${key}`} className="block text-[12px] font-medium text-ink">Notes</label>
          <input id={`pt-${key}`} name="notes" defaultValue={partner?.notes ?? ""} className={inputClass} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-[12px] text-ink">
        <input type="checkbox" name="active" defaultChecked={partner?.active ?? true} className="rounded border-line-strong" />
        Active — boards can send requests to them
      </label>
      {state?.error ? <p className="text-[12px] text-bad-text">{state.error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="min-h-[44px] rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] rounded-md border border-line-strong px-4 text-[13px] text-ink hover:bg-fill">
          Cancel
        </button>
      </div>
    </form>
  );
}
