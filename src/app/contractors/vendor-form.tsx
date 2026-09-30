"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneInput } from "@/components/phone-input";
import { TRADES } from "@/lib/contractors/trades";
import { addVendor, updateVendor } from "./vendor-actions";

export interface VendorRecord {
  id: string;
  name: string;
  trades: string[];
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  website_url: string | null;
  address: string | null;
  status: string;
  do_not_use_reason: string | null;
  board_rating: number | null;
  entity_type: string | null;
  license_number: string | null;
  license_expires_on: string | null;
  insured_until: string | null;
  w9_on_file: boolean;
  w9_received_on: string | null;
  tin_last4: string | null;
  is_1099_exempt: boolean;
  notes: string | null;
}

const ENTITY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Not sure" },
  { value: "individual", label: "Individual" },
  { value: "sole_prop", label: "Sole proprietor" },
  { value: "llc", label: "LLC" },
  { value: "partnership", label: "Partnership" },
  { value: "s_corp", label: "S corporation" },
  { value: "c_corp", label: "C corporation" },
  { value: "other", label: "Other" },
];

const inputClass = "mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink";

/**
 * Add or edit a contractor. Only three things are required — a name, at
 * least one kind of work, and a phone or email — so saving "the plumber Sarah
 * recommended" takes seconds. Everything else waits under "More details."
 */
export function VendorForm({
  vendor,
  onClose,
  initialTrade,
}: {
  vendor: VendorRecord | null;
  onClose: () => void;
  initialTrade?: string | null;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(vendor ? updateVendor : addVendor, null);
  const [status, setStatus] = useState(vendor?.status ?? "okay");
  const [w9, setW9] = useState(vendor?.w9_on_file ?? false);
  const prefix = vendor?.id ?? "new";
  const id = (k: string) => `${prefix}-${k}`;
  const selectedTrades = new Set(vendor?.trades ?? (initialTrade ? [initialTrade] : []));

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) {
      onClose();
      const newId = (state as { vendorId?: string }).vendorId;
      if (!vendor && newId) router.push(`/contractors/${newId}`);
    }
  }

  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-paper p-5">
      {vendor ? <input type="hidden" name="vendor_id" value={vendor.id} /> : null}
      {!vendor ? (
        <p className="text-[12px] text-mute">Just a name and a way to reach them is enough to start.</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={id("name")} className="block text-[12px] font-medium text-ink">
            Company or person
          </label>
          <input id={id("name")} name="name" required defaultValue={vendor?.name ?? ""} className={inputClass} />
        </div>

        <fieldset className="sm:col-span-2">
          <legend className="text-[12px] font-medium text-ink">What kind of work</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {TRADES.map((t) => (
              <label
                key={t.slug}
                className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-full border border-line-strong px-3 text-[12px] text-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper"
              >
                <input
                  type="checkbox"
                  name="trades"
                  value={t.slug}
                  defaultChecked={selectedTrades.has(t.slug)}
                  className="sr-only"
                />
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor={id("phone")} className="block text-[12px] font-medium text-ink">Phone</label>
          <PhoneInput id={id("phone")} name="phone" defaultValue={vendor?.phone} className={inputClass} />
        </div>
        <div>
          <label htmlFor={id("email")} className="block text-[12px] font-medium text-ink">Email</label>
          <input id={id("email")} name="email" type="email" defaultValue={vendor?.email ?? ""} className={inputClass} />
        </div>

        <div>
          <label htmlFor={id("status")} className="block text-[12px] font-medium text-ink">Status</label>
          <select
            id={id("status")}
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={inputClass}
          >
            <option value="preferred">Preferred — call them first</option>
            <option value="okay">Okay</option>
            <option value="do_not_use">Do not use</option>
          </select>
        </div>
        {status === "do_not_use" ? (
          <div>
            <label htmlFor={id("reason")} className="block text-[12px] font-medium text-ink">Why not?</label>
            <input
              id={id("reason")}
              name="do_not_use_reason"
              required
              defaultValue={vendor?.do_not_use_reason ?? ""}
              placeholder="No-show twice in 2025"
              className={inputClass}
            />
          </div>
        ) : null}
      </div>

      <details className="rounded-lg border border-line px-4 py-3" open={Boolean(vendor)}>
        <summary className="cursor-pointer text-[13px] font-medium text-ink">More details</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={id("contact")} className="block text-[12px] font-medium text-ink">Contact person</label>
            <input id={id("contact")} name="contact_name" defaultValue={vendor?.contact_name ?? ""} className={inputClass} />
          </div>
          <div>
            <label htmlFor={id("website")} className="block text-[12px] font-medium text-ink">Website</label>
            <input id={id("website")} name="website_url" defaultValue={vendor?.website_url ?? ""} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={id("address")} className="block text-[12px] font-medium text-ink">Address</label>
            <input id={id("address")} name="address" defaultValue={vendor?.address ?? ""} className={inputClass} />
          </div>
          <div>
            <label htmlFor={id("rating")} className="block text-[12px] font-medium text-ink">
              Your building&rsquo;s rating
            </label>
            <select id={id("rating")} name="board_rating" defaultValue={vendor?.board_rating ?? ""} className={inputClass}>
              <option value="">Not rated</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {"★".repeat(n)} ({n} of 5)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={id("entity")} className="block text-[12px] font-medium text-ink">
              Business type <span className="font-normal text-mute-soft">from their W-9</span>
            </label>
            <select id={id("entity")} name="entity_type" defaultValue={vendor?.entity_type ?? ""} className={inputClass}>
              {ENTITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <p className="text-[12px] font-medium text-ink sm:col-span-2">Paperwork</p>
          <div>
            <label htmlFor={id("license")} className="block text-[12px] font-medium text-ink">License number</label>
            <input id={id("license")} name="license_number" defaultValue={vendor?.license_number ?? ""} className={`figures ${inputClass}`} />
          </div>
          <div>
            <label htmlFor={id("license-exp")} className="block text-[12px] font-medium text-ink">License expires</label>
            <input id={id("license-exp")} name="license_expires_on" type="date" defaultValue={vendor?.license_expires_on ?? ""} className={inputClass} />
          </div>
          <div>
            <label htmlFor={id("coi")} className="block text-[12px] font-medium text-ink">
              Insurance certificate expires
            </label>
            <input id={id("coi")} name="insured_until" type="date" defaultValue={vendor?.insured_until ?? ""} className={inputClass} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <label className="flex items-center gap-2 text-[12px] text-ink">
              <input type="checkbox" name="w9_on_file" checked={w9} onChange={(e) => setW9(e.target.checked)} className="rounded border-line-strong" />
              W-9 on file
            </label>
            {w9 ? (
              <div className="grid gap-3 pl-6 sm:grid-cols-2">
                <div>
                  <label htmlFor={id("w9-date")} className="block text-[12px] font-medium text-ink">Received on</label>
                  <input id={id("w9-date")} name="w9_received_on" type="date" defaultValue={vendor?.w9_received_on ?? ""} className={inputClass} />
                </div>
                <div>
                  <label htmlFor={id("tin")} className="block text-[12px] font-medium text-ink">Tax ID, last four digits only</label>
                  <input
                    id={id("tin")}
                    name="tin_last4"
                    inputMode="numeric"
                    maxLength={4}
                    pattern="[0-9]{4}"
                    placeholder="1234"
                    defaultValue={vendor?.tin_last4 ?? ""}
                    className={`figures ${inputClass}`}
                  />
                  <p className="mt-1 text-[11px] text-mute-soft">Never the full number — file the W-9 itself in the Document Hub.</p>
                </div>
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-[12px] text-ink">
              <input type="checkbox" name="is_1099_exempt" defaultChecked={vendor?.is_1099_exempt ?? false} className="rounded border-line-strong" />
              1099-exempt <span className="text-mute-soft">(a corporation, or paid by card)</span>
            </label>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={id("notes")} className="block text-[12px] font-medium text-ink">Notes</label>
            <textarea id={id("notes")} name="notes" rows={3} defaultValue={vendor?.notes ?? ""} className={inputClass} />
          </div>
        </div>
      </details>

      {state?.error ? (
        <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">{state.error}</p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="min-h-[44px] rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
        >
          {pending ? "Saving…" : vendor ? "Save changes" : "Save contractor"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** "Add a contractor" button that opens the form in place. */
export function AddVendorButton({ initialTrade, label = "Add a contractor" }: { initialTrade?: string | null; label?: string }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <VendorForm vendor={null} onClose={() => setOpen(false)} initialTrade={initialTrade} />
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="min-h-[44px] rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid"
    >
      {label}
    </button>
  );
}

/** Edit button on the detail page. */
export function EditVendorButton({ vendor }: { vendor: VendorRecord }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <VendorForm vendor={vendor} onClose={() => setOpen(false)} />
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="min-h-[44px] rounded-md border border-line-strong bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-fill"
    >
      Edit details
    </button>
  );
}
