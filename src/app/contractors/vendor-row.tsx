"use client";

import { useActionState, useState } from "react";
import { updateVendor } from "./vendor-actions";
import { VendorFormFields, type VendorRecord } from "./vendor-form-fields";

export function VendorRow({
  vendor,
  canEdit,
  todayIso,
}: {
  vendor: VendorRecord;
  canEdit: boolean;
  todayIso: string;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(updateVendor, null);

  // Close only on a *new* successful submission — see add-unit-form.tsx.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) setEditing(false);
  }

  if (editing) {
    return (
      <li className="py-3">
        <form action={action} className="space-y-3">
          <input type="hidden" name="vendor_id" value={vendor.id} />
          <VendorFormFields vendor={vendor} prefix={vendor.id} />
          {state?.error ? <p className="text-[12px] text-bad-text">{state.error}</p> : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill"
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  const isLapsed = Boolean(vendor.insured_until && vendor.insured_until < todayIso);

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink">{vendor.name}</span>
          {vendor.is_preferred ? (
            <span className="rounded-full border border-good-line bg-good-tint px-2 py-0.5 text-[11px] text-good-text">
              preferred
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-[13px] text-mute">
          {[vendor.trade, vendor.contact_name, vendor.phone, vendor.email].filter(Boolean).join(" · ")}
        </div>
        {vendor.license_number ? (
          <div className="mt-0.5 text-[11px] text-mute-soft">Licence {vendor.license_number}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-right text-[11px]">
        {isLapsed ? (
          <div className="font-medium text-bad-text">Insurance expired {vendor.insured_until}</div>
        ) : vendor.insured_until ? (
          <div className="text-mute">Insured to {vendor.insured_until}</div>
        ) : (
          <div className="text-warning-text">No insurance on file</div>
        )}
        <div className={vendor.w9_on_file ? "text-mute" : "text-warning-text"}>
          {vendor.w9_on_file ? "W-9 on file" : vendor.is_1099_exempt ? "1099 exempt" : "W-9 missing"}
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[12px] text-mute underline-offset-2 hover:underline"
          >
            Edit
          </button>
        ) : null}
      </div>
    </li>
  );
}
