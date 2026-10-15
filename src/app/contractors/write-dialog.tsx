"use client";

import { useId, useState, useTransition } from "react";
import { createDraft, type DraftKind } from "./actions";
import { ContractorDraft } from "@/components/repairs/contractor-draft";
import { Sheet } from "@/components/repairs/sheet";
import { btnPrimary, btnSecondary, errorClass, hintClass, inputClass, labelClass } from "@/components/repairs/styles";

type About = "problem" | "w9" | "coi" | "other";

const KIND: Record<About, DraftKind> = { problem: "general", w9: "w9_request", coi: "coi_request", other: "general" };

/**
 * "Write to a contractor" (repairs-spec §10.1 item 4): pick who and what
 * about, Walkup fills a template, and the draft opens in DraftEmail. Nothing
 * is sent; the board sends it from their own mail app and marks it sent.
 */
export function WriteToContractor(props: {
  contractors: { id: string; name: string; email: string | null }[];
  tickets: { id: string; reference: number; title: string }[];
  /** Fixed contractor (the profile's buttons). */
  vendorId?: string;
  /** Start with this choice and skip the form (the profile's "Email", "Ask for a W-9" ...). */
  preset?: { kind: DraftKind; ticketId?: string | null };
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const fid = useId();
  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState(props.vendorId ?? "");
  const [about, setAbout] = useState<About>("problem");
  const [ticketId, setTicketId] = useState("");
  const [other, setOther] = useState("");
  const [draft, setDraft] = useState<{ messageId: string; to: string[]; subject: string; body: string; existing: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const vendor = props.contractors.find((c) => c.id === vendorId) ?? null;

  function make(kind: DraftKind, t: string | null, o: string | null, v: string) {
    setError(null);
    start(async () => {
      const r = await createDraft({ vendorId: v, kind, ticketId: t || null, about: o?.trim() || null });
      if ("error" in r) setError(r.error);
      else setDraft(r);
    });
  }

  function openIt() {
    setDraft(null);
    setError(null);
    setOpen(true);
    if (props.preset && props.vendorId) make(props.preset.kind, props.preset.ticketId ?? null, null, props.vendorId);
  }

  function close() {
    setOpen(false);
    setDraft(null);
    setError(null);
    if (!props.vendorId) setVendorId("");
  }

  const canDraft = Boolean(vendorId) && (about !== "problem" || Boolean(ticketId));

  return (
    <>
      <button type="button" onClick={openIt} className={props.variant === "primary" ? btnPrimary : btnSecondary}>
        {props.label ?? "Write to a contractor"}
      </button>
      <Sheet
        open={open}
        onClose={close}
        wide
        title={draft ? `Email to ${vendor?.name ?? "the contractor"}` : "Write to a contractor"}
        footer={
          draft ? (
            <button type="button" onClick={close} className={btnPrimary}>
              Done
            </button>
          ) : props.preset ? (
            <button type="button" onClick={close} className={btnSecondary}>
              Cancel
            </button>
          ) : (
            <>
              <button type="button" disabled={!canDraft || pending} onClick={() => make(KIND[about], about === "problem" ? ticketId : null, about === "other" ? other : null, vendorId)} className={btnPrimary}>
                {pending ? "Drafting…" : "Write the email"}
              </button>
              <button type="button" onClick={close} className={btnSecondary}>
                Cancel
              </button>
            </>
          )
        }
      >
        {draft ? (
          <div className="space-y-3">
            {draft.existing ? <p className="text-[13px] text-mute">You already had a draft like this, so here it is.</p> : null}
            {draft.to.length === 0 ? (
              <p className="text-[13px] text-mute">There&rsquo;s no email address on file for them. Add one, or copy the text into a message.</p>
            ) : null}
            <ContractorDraft messageId={draft.messageId} to={draft.to} subject={draft.subject} body={draft.body} discardable onSent={close} />
          </div>
        ) : props.preset ? (
          pending ? (
            <p role="status" className="text-[13px] text-mute">
              Drafting…
            </p>
          ) : error ? (
            <p className={errorClass}>{error}</p>
          ) : null
        ) : (
          <div className="space-y-4">
            {props.vendorId ? null : (
              <div>
                <label htmlFor={`${fid}-who`} className={labelClass}>
                  Contractor
                </label>
                <select id={`${fid}-who`} value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={inputClass}>
                  <option value="">Choose…</option>
                  {props.contractors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {vendor && !vendor.email ? <p className={hintClass}>No email on file. You can still copy the text.</p> : null}
              </div>
            )}
            <div>
              <label htmlFor={`${fid}-about`} className={labelClass}>
                What about?
              </label>
              <select id={`${fid}-about`} value={about} onChange={(e) => setAbout(e.target.value as About)} className={inputClass}>
                <option value="problem">A problem</option>
                <option value="w9">A W-9</option>
                <option value="coi">An insurance certificate</option>
                <option value="other">Something else</option>
              </select>
            </div>
            {about === "problem" ? (
              <div>
                <label htmlFor={`${fid}-ticket`} className={labelClass}>
                  Which problem
                </label>
                <select id={`${fid}-ticket`} value={ticketId} onChange={(e) => setTicketId(e.target.value)} className={inputClass}>
                  <option value="">Choose…</option>
                  {props.tickets.map((t) => (
                    <option key={t.id} value={t.id}>
                      #{t.reference} {t.title}
                    </option>
                  ))}
                </select>
                {props.tickets.length === 0 ? <p className={hintClass}>No open problems right now.</p> : null}
              </div>
            ) : null}
            {about === "other" ? (
              <div>
                <label htmlFor={`${fid}-other`} className={labelClass}>
                  In a few words (optional)
                </label>
                <input id={`${fid}-other`} value={other} maxLength={120} onChange={(e) => setOther(e.target.value)} className={inputClass} />
              </div>
            ) : null}
            {error ? <p className={errorClass}>{error}</p> : null}
          </div>
        )}
      </Sheet>
    </>
  );
}
