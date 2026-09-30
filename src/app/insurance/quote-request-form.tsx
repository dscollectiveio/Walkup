"use client";

import { useActionState, useState } from "react";
import { createQuoteRequests } from "./actions";

export interface QuotePrefill {
  policyId: string | null;
  legalName: string;
  address: string;
  units: number;
  yearBuilt: number | null;
  constructionType: string | null;
  stories: number | null;
  roofReplacedYear: number | null;
  currentCarrier: string | null;
  currentPremium: number | null;
  currentExpiresOn: string | null;
  buildingLimit: number | null;
  liability: number | null;
  doLimit: number | null;
  umbrellaLimit: number | null;
  flood: boolean | null;
  claims: string;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string;
}

const inputClass = "mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink";

function Field({ id, label, defaultValue, optional, type = "text" }: { id: string; label: string; defaultValue: string | number | null; optional?: boolean; type?: string }) {
  return (
    <div>
      <label htmlFor={`qr-${id}`} className="block text-[12px] font-medium text-ink">
        {label}
        {optional ? <span className="ml-1 font-normal text-mute-soft">optional</span> : null}
      </label>
      <input id={`qr-${id}`} name={id} type={type} defaultValue={defaultValue ?? ""} className={inputClass} />
    </div>
  );
}

/**
 * Everything a broker needs, pre-filled from the saved policy and the
 * building, all editable. Walkup doesn't send it — each request becomes a
 * draft the board sends from its own email.
 */
export function QuoteRequestForm({ prefill, partners }: { prefill: QuotePrefill; partners: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createQuoteRequests, null);
  const [prev, setPrev] = useState(state);
  if (state !== prev) {
    setPrev(state);
    if (state?.ok) setOpen(false);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-[44px] rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid">
        Request quotes
      </button>
    );
  }

  const p = prefill;
  return (
    <form action={action} className="space-y-5 rounded-xl border border-line bg-paper p-5">
      {p.policyId ? <input type="hidden" name="policy_id" value={p.policyId} /> : null}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-[13px] font-medium text-ink">The association</legend>
        <Field id="legal_name" label="Legal name" defaultValue={p.legalName} />
        <Field id="address" label="Address" defaultValue={p.address} />
        <Field id="units" label="Number of units" defaultValue={p.units} type="number" />
        <Field id="year_built" label="Year built" defaultValue={p.yearBuilt} type="number" optional />
        <Field id="construction_type" label="Construction" defaultValue={p.constructionType} optional />
        <Field id="stories" label="Stories" defaultValue={p.stories} type="number" optional />
        <Field id="roof_replaced_year" label="Roof last replaced (year)" defaultValue={p.roofReplacedYear} type="number" optional />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-[13px] font-medium text-ink">Current policy</legend>
        <Field id="current_carrier" label="Insurer" defaultValue={p.currentCarrier} optional />
        <Field id="current_premium" label="Annual premium" defaultValue={p.currentPremium} optional />
        <Field id="current_expires_on" label="Renews on" defaultValue={p.currentExpiresOn} type="date" optional />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-[13px] font-medium text-ink">Coverage wanted</legend>
        <Field id="want_building_limit" label="Building" defaultValue={p.buildingLimit} optional />
        <Field id="want_liability" label="Liability" defaultValue={p.liability} optional />
        <Field id="want_do_limit" label="Directors & officers" defaultValue={p.doLimit} optional />
        <Field id="want_umbrella_limit" label="Umbrella" defaultValue={p.umbrellaLimit} optional />
        <div>
          <label htmlFor="qr-want_flood" className="block text-[12px] font-medium text-ink">Flood</label>
          <select id="qr-want_flood" name="want_flood" defaultValue={p.flood === null ? "" : p.flood ? "yes" : "no"} className={inputClass}>
            <option value="">Not sure</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
      </fieldset>

      <div>
        <label htmlFor="qr-claims" className="block text-[12px] font-medium text-ink">Claims in the last 5 years</label>
        <textarea id="qr-claims" name="claims" rows={3} defaultValue={p.claims} className={inputClass} />
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-[13px] font-medium text-ink">Who the broker should contact</legend>
        <Field id="contact_name" label="Name" defaultValue={p.contactName} />
        <Field id="contact_phone" label="Phone" defaultValue={p.contactPhone} optional />
        <Field id="contact_email" label="Email" defaultValue={p.contactEmail} type="email" />
      </fieldset>

      <div>
        <label htmlFor="qr-else" className="block text-[12px] font-medium text-ink">
          Anything else <span className="font-normal text-mute-soft">optional</span>
        </label>
        <textarea id="qr-else" name="anything_else" rows={2} className={inputClass} />
      </div>

      <fieldset>
        <legend className="text-[13px] font-medium text-ink">Send to</legend>
        <div className="mt-2 space-y-1.5">
          {partners.map((pt) => (
            <label key={pt.id} className="flex items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" name="partner_id" value={pt.id} defaultChecked className="rounded border-line-strong" />
              {pt.name}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-start gap-2 text-[12px] text-ink">
        <input type="checkbox" name="consent" required className="mt-0.5 rounded border-line-strong" />
        <span>
          These details will be sent to {partners.map((pt) => pt.name).join(", ")}. They may contact you directly.
        </span>
      </label>

      {state?.error ? <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">{state.error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="min-h-[44px] rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50">
          {pending ? "Preparing…" : "Prepare the requests"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] rounded-md border border-line-strong px-4 text-[13px] text-ink hover:bg-fill">
          Cancel
        </button>
      </div>
      <p className="text-[11px] text-mute">
        Walkup doesn&rsquo;t send email. Each request is prepared for you to send from your own email, so the broker&rsquo;s reply comes back to you.
      </p>
    </form>
  );
}
