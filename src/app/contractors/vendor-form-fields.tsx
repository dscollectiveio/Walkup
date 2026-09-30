"use client";

import { useState } from "react";
import { PhoneInput } from "@/components/phone-input";

export interface VendorRecord {
  id: string;
  name: string;
  trade: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  entity_type: string | null;
  is_preferred: boolean;
  license_number: string | null;
  insured_until: string | null;
  w9_on_file: boolean;
  w9_received_on: string | null;
  tin_last4: string | null;
  is_1099_exempt: boolean;
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

const inputClass = "mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink";

/** The field grid shared by "Add a contractor" and the per-row edit. `prefix` keeps ids unique per row. */
export function VendorFormFields({ vendor, prefix }: { vendor: VendorRecord | null; prefix: string }) {
  const [w9, setW9] = useState(vendor?.w9_on_file ?? false);
  const id = (k: string) => `${prefix}-${k}`;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor={id("name")} className="block text-[12px] font-medium text-ink">
          Business or person
        </label>
        <input id={id("name")} name="name" required defaultValue={vendor?.name ?? ""} className={inputClass} />
      </div>
      <div>
        <label htmlFor={id("trade")} className="block text-[12px] font-medium text-ink">
          Trade
          <span className="ml-1 font-normal text-mute-soft">plumber, snow, cleaning…</span>
        </label>
        <input id={id("trade")} name="trade" defaultValue={vendor?.trade ?? ""} className={inputClass} />
      </div>

      <div>
        <label htmlFor={id("contact_name")} className="block text-[12px] font-medium text-ink">
          Contact name
          <span className="ml-1 font-normal text-mute-soft">optional</span>
        </label>
        <input id={id("contact_name")} name="contact_name" defaultValue={vendor?.contact_name ?? ""} className={inputClass} />
      </div>
      <div>
        <label htmlFor={id("phone")} className="block text-[12px] font-medium text-ink">
          Phone
        </label>
        <PhoneInput id={id("phone")} name="phone" defaultValue={vendor?.phone} className={inputClass} />
      </div>

      <div>
        <label htmlFor={id("email")} className="block text-[12px] font-medium text-ink">
          Email
        </label>
        <input id={id("email")} name="email" type="email" defaultValue={vendor?.email ?? ""} className={inputClass} />
      </div>
      <div>
        <label htmlFor={id("entity_type")} className="block text-[12px] font-medium text-ink">
          Business type
          <span className="ml-1 font-normal text-mute-soft">from their W-9</span>
        </label>
        <select id={id("entity_type")} name="entity_type" defaultValue={vendor?.entity_type ?? ""} className={`${inputClass} bg-paper`}>
          {ENTITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={id("license_number")} className="block text-[12px] font-medium text-ink">
          Licence number
          <span className="ml-1 font-normal text-mute-soft">optional</span>
        </label>
        <input id={id("license_number")} name="license_number" defaultValue={vendor?.license_number ?? ""} className={`figures ${inputClass}`} />
      </div>
      <div>
        <label htmlFor={id("insured_until")} className="block text-[12px] font-medium text-ink">
          Insurance certificate expires
          <span className="ml-1 font-normal text-mute-soft">optional</span>
        </label>
        <input id={id("insured_until")} name="insured_until" type="date" defaultValue={vendor?.insured_until ?? ""} className={inputClass} />
      </div>

      <div className="space-y-2 sm:col-span-2">
        <label className="flex items-center gap-2 text-[12px] text-ink">
          <input type="checkbox" name="is_preferred" defaultChecked={vendor?.is_preferred ?? false} className="rounded border-line-strong" />
          Preferred — call these people first
        </label>
        <label className="flex items-center gap-2 text-[12px] text-ink">
          <input
            type="checkbox"
            name="w9_on_file"
            checked={w9}
            onChange={(e) => setW9(e.target.checked)}
            className="rounded border-line-strong"
          />
          W-9 on file
        </label>
        {w9 ? (
          <div className="grid gap-3 pl-6 sm:grid-cols-2">
            <div>
              <label htmlFor={id("w9_received_on")} className="block text-[12px] font-medium text-ink">
                Received on
              </label>
              <input id={id("w9_received_on")} name="w9_received_on" type="date" defaultValue={vendor?.w9_received_on ?? ""} className={inputClass} />
            </div>
            <div>
              <label htmlFor={id("tin_last4")} className="block text-[12px] font-medium text-ink">
                Tax ID, last four digits only
              </label>
              <input
                id={id("tin_last4")}
                name="tin_last4"
                inputMode="numeric"
                maxLength={4}
                pattern="[0-9]{4}"
                placeholder="1234"
                defaultValue={vendor?.tin_last4 ?? ""}
                className={`figures ${inputClass}`}
              />
              <p className="mt-1 text-[11px] text-mute-soft">
                Never the full number — file the W-9 itself in the Document Hub.
              </p>
            </div>
          </div>
        ) : null}
        <label className="flex items-center gap-2 text-[12px] text-ink">
          <input type="checkbox" name="is_1099_exempt" defaultChecked={vendor?.is_1099_exempt ?? false} className="rounded border-line-strong" />
          1099-exempt
          <span className="text-mute-soft">(a corporation, or paid by card)</span>
        </label>
      </div>
    </div>
  );
}
