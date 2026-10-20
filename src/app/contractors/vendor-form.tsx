"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneInput } from "@/components/phone-input";
import { btnLink, btnPrimary, btnSecondary } from "@/components/repairs/styles";
import { Sheet } from "@/components/repairs/sheet";
import { HEADER_BUTTON } from "@/components/ui";
import { TRADE_GROUP_LABEL, TRADES, type TradeGroup } from "@/lib/contractors/trades";
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
  emergency_service: boolean;
  job_tags: string[];
  other_contact_name: string | null;
  other_contact_role: string | null;
  other_contact_phone: string | null;
  other_contact_email: string | null;
  payment_methods: string | null;
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

const JOB_TAG_OPTIONS: { value: string; label: string }[] = [
  { value: "condo_work", label: "Works on condo or multi-unit buildings" },
  { value: "small_jobs", label: "Takes small jobs" },
  { value: "free_estimates", label: "Gives free estimates" },
];

const GROUPS: TradeGroup[] = ["common", "systems", "outside", "specialist", "other"];

const inputClass = "mt-1 block w-full min-h-[44px] rounded-lg border border-line-strong bg-paper px-3 py-2 text-[16px] text-ink sm:text-[13px]";
const labelClass = "block text-[12px] font-medium text-ink";
const checkRow = "flex min-h-[44px] cursor-pointer items-center gap-2 text-[13px] text-ink";

/**
 * Add or edit a contractor (repairs-spec §10.3). Only three things are
 * required: a name, at least one kind of work, and a phone, email or
 * website, so saving "the plumber Sarah recommended" takes seconds.
 * Everything else waits under "More details."
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
  const tags = new Set(vendor?.job_tags ?? []);

  // Close and navigate after a successful save. These touch the parent and the
  // router, so they run in an effect, not while this component renders.
  useEffect(() => {
    if (!state?.ok) return;
    onClose();
    const newId = (state as { vendorId?: string }).vendorId;
    if (!vendor && newId) router.push(`/contractors/${newId}`);
    else router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per new result
  }, [state]);

  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-paper p-4 sm:p-5">
      {vendor ? <input type="hidden" name="vendor_id" value={vendor.id} /> : null}
      {!vendor ? <p className="text-[12px] text-mute">Just a name and a way to reach them is enough to start.</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={id("name")} className={labelClass}>
            Company or person
          </label>
          <input id={id("name")} name="name" required defaultValue={vendor?.name ?? ""} className={inputClass} />
        </div>

        <fieldset className="space-y-3 sm:col-span-2">
          <legend className={labelClass}>What kind of work</legend>
          {GROUPS.map((g) => {
            const trades = TRADES.filter((t) => t.group === g);
            if (trades.length === 0) return null;
            return (
              <div key={g}>
                <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.07em] text-section-label">{TRADE_GROUP_LABEL[g]}</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {trades.map((t) => (
                    <label
                      key={t.slug}
                      className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-full border border-line-strong px-3 text-[12px] text-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brass"
                    >
                      <input type="checkbox" name="trades" value={t.slug} defaultChecked={selectedTrades.has(t.slug)} className="sr-only" />
                      {t.label}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </fieldset>

        <div>
          <label htmlFor={id("phone")} className={labelClass}>
            Phone
          </label>
          <PhoneInput id={id("phone")} name="phone" defaultValue={vendor?.phone} className={inputClass} />
        </div>
        <div>
          <label htmlFor={id("email")} className={labelClass}>
            Email
          </label>
          <input id={id("email")} name="email" type="email" defaultValue={vendor?.email ?? ""} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={id("website")} className={labelClass}>
            Website
          </label>
          <input id={id("website")} name="website_url" defaultValue={vendor?.website_url ?? ""} className={inputClass} />
          <p className="mt-1 text-[11px] text-mute">A phone number, email or website is enough to save them.</p>
        </div>

        <div>
          <label htmlFor={id("status")} className={labelClass}>
            Status
          </label>
          <select id={id("status")} name="status" value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
            <option value="preferred">Preferred: call them first</option>
            <option value="okay">Okay</option>
            <option value="do_not_use">Do not use</option>
          </select>
        </div>
        {status === "do_not_use" ? (
          <div>
            <label htmlFor={id("reason")} className={labelClass}>
              Why not?
            </label>
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
        <summary className="flex min-h-[44px] cursor-pointer items-center text-[13px] font-medium text-ink">More details</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={id("contact")} className={labelClass}>
              Contact person
            </label>
            <input id={id("contact")} name="contact_name" defaultValue={vendor?.contact_name ?? ""} className={inputClass} />
          </div>
          <div>
            <label htmlFor={id("address")} className={labelClass}>
              Address
            </label>
            <input id={id("address")} name="address" defaultValue={vendor?.address ?? ""} className={inputClass} />
          </div>

          <div className="sm:col-span-2">
            <label className={checkRow}>
              <input type="checkbox" name="emergency_service" defaultChecked={vendor?.emergency_service ?? false} className="h-5 w-5" />
              Takes emergency or after-hours calls
            </label>
            <p className="ml-7 text-[11px] text-mute">Shown as &ldquo;Your board says&rdquo; so nobody mistakes it for a check.</p>
          </div>
          <fieldset className="sm:col-span-2">
            <legend className={labelClass}>What else is true about them</legend>
            <div className="mt-1">
              {JOB_TAG_OPTIONS.map((o) => (
                <label key={o.value} className={checkRow}>
                  <input type="checkbox" name="job_tags" value={o.value} defaultChecked={tags.has(o.value)} className="h-5 w-5" />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
            <legend className={`${labelClass} sm:col-span-2`}>Other contact</legend>
            <div>
              <label htmlFor={id("oc-name")} className={labelClass}>
                Name
              </label>
              <input id={id("oc-name")} name="other_contact_name" maxLength={120} defaultValue={vendor?.other_contact_name ?? ""} className={inputClass} />
            </div>
            <div>
              <label htmlFor={id("oc-role")} className={labelClass}>
                Role
              </label>
              <input
                id={id("oc-role")}
                name="other_contact_role"
                maxLength={60}
                placeholder="Office or Technician"
                defaultValue={vendor?.other_contact_role ?? ""}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor={id("oc-phone")} className={labelClass}>
                Phone
              </label>
              <PhoneInput id={id("oc-phone")} name="other_contact_phone" defaultValue={vendor?.other_contact_phone} className={inputClass} />
            </div>
            <div>
              <label htmlFor={id("oc-email")} className={labelClass}>
                Email
              </label>
              <input id={id("oc-email")} name="other_contact_email" type="email" defaultValue={vendor?.other_contact_email ?? ""} className={inputClass} />
            </div>
          </fieldset>

          <div>
            <label htmlFor={id("payment")} className={labelClass}>
              Payment methods
            </label>
            <input
              id={id("payment")}
              name="payment_methods"
              maxLength={120}
              placeholder="Check or Zelle"
              defaultValue={vendor?.payment_methods ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={id("rating")} className={labelClass}>
              Your building&rsquo;s rating
            </label>
            <select id={id("rating")} name="board_rating" defaultValue={vendor?.board_rating ?? ""} className={inputClass}>
              <option value="">Not rated</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} of 5
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={id("entity")} className={labelClass}>
              Business type <span className="font-normal text-mute-soft">from their W-9</span>
            </label>
            <select id={id("entity")} name="entity_type" defaultValue={vendor?.entity_type ?? ""} className={inputClass}>
              {ENTITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <p className="text-[12px] font-medium text-ink sm:col-span-2">Paperwork</p>
          <div>
            <label htmlFor={id("license")} className={labelClass}>
              License number
            </label>
            <input id={id("license")} name="license_number" defaultValue={vendor?.license_number ?? ""} className={`figures ${inputClass}`} />
          </div>
          <div>
            <label htmlFor={id("license-exp")} className={labelClass}>
              License expires
            </label>
            <input id={id("license-exp")} name="license_expires_on" type="date" defaultValue={vendor?.license_expires_on ?? ""} className={inputClass} />
          </div>
          <div>
            <label htmlFor={id("coi")} className={labelClass}>
              Insurance certificate expires
            </label>
            <input id={id("coi")} name="insured_until" type="date" defaultValue={vendor?.insured_until ?? ""} className={inputClass} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label className={checkRow}>
              <input
                type="checkbox"
                name="w9_on_file"
                checked={w9}
                onChange={(e) => {
                  const next = e.target.checked;
                  // Unticking clears the received date and tax ID digits on save: say so first.
                  if (!next && (vendor?.w9_received_on || vendor?.tin_last4)) {
                    if (!window.confirm("This clears the W-9 date and tax ID digits. Continue?")) return;
                  }
                  setW9(next);
                }}
                className="h-5 w-5"
              />
              W-9 on file
            </label>
            {w9 ? (
              <div className="grid gap-3 pl-7 sm:grid-cols-2">
                <div>
                  <label htmlFor={id("w9-date")} className={labelClass}>
                    Received on
                  </label>
                  <input id={id("w9-date")} name="w9_received_on" type="date" defaultValue={vendor?.w9_received_on ?? ""} className={inputClass} />
                </div>
                <div>
                  <label htmlFor={id("tin")} className={labelClass}>
                    Tax ID, last four digits only
                  </label>
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
                  <p className="mt-1 text-[11px] text-mute-soft">Never the full number. File the W-9 itself in Documents.</p>
                </div>
              </div>
            ) : null}
            <label className={checkRow}>
              <input type="checkbox" name="is_1099_exempt" defaultChecked={vendor?.is_1099_exempt ?? false} className="h-5 w-5" />
              <span>
                1099-exempt <span className="text-mute-soft">(a corporation, or paid by card)</span>
              </span>
            </label>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={id("notes")} className={labelClass}>
              Summary for the next board
            </label>
            <textarea id={id("notes")} name="notes" rows={3} defaultValue={vendor?.notes ?? ""} className={inputClass} />
          </div>
        </div>
      </details>

      {state?.error ? <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">{state.error}</p> : null}

      <div className="flex flex-wrap gap-2 max-sm:[&>*]:flex-1">
        <button
          type="submit"
          disabled={pending}
          className={btnPrimary}
        >
          {pending ? "Saving…" : vendor ? "Save changes" : "Save contractor"}
        </button>
        <button type="button" onClick={onClose} className={btnSecondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** "Add a contractor" that opens the form in place (a full-width panel, never in a card header). */
export function AddVendorButton({
  initialTrade,
  label = "Add a contractor",
  variant = "primary",
}: {
  initialTrade?: string | null;
  label?: string;
  variant?: "primary" | "secondary" | "link" | "header" | "solid";
}) {
  const [open, setOpen] = useState(false);
  // On a card header ("header") or in a row of buttons ("solid") the form opens in a sheet instead of replacing the button.
  if (variant === "header" || variant === "solid") {
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className={variant === "solid" ? btnPrimary : HEADER_BUTTON}>
          {label}
        </button>
        <Sheet open={open} onClose={() => setOpen(false)} wide title="Add a contractor">
          {open ? <VendorForm vendor={null} onClose={() => setOpen(false)} initialTrade={initialTrade} /> : null}
        </Sheet>
      </>
    );
  }
  if (open) return <VendorForm vendor={null} onClose={() => setOpen(false)} initialTrade={initialTrade} />;
  const cls =
    variant === "link"
      ? btnLink
      : variant === "secondary"
        ? btnSecondary
        : btnPrimary;
  return (
    <button type="button" onClick={() => setOpen(true)} className={cls}>
      {label}
    </button>
  );
}

/** "Edit details" on the profile. */
export function EditVendorButton({ vendor, label = "Edit details" }: { vendor: VendorRecord; label?: string }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <div className="w-full">
      <VendorForm vendor={vendor} onClose={() => setOpen(false)} />
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="min-h-[44px] rounded-md border border-line-strong bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-fill"
    >
      {label}
    </button>
  );
}
