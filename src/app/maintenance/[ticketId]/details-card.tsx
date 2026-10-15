"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTicketDetails } from "@/app/maintenance/actions";
import { Sheet } from "@/components/repairs/sheet";
import { btnPrimary, btnSecondary, choiceRow, errorClass, hintClass, inputClass, labelClass, textareaClass } from "@/components/repairs/styles";
import { TRADE_GROUP_LABEL, TRADES, type TradeGroup } from "@/lib/contractors/trades";
import { EMERGENCY_KIND_LABEL, EMERGENCY_KINDS, type EmergencyKind } from "@/lib/repairs/emergency";
import { PRIORITY_LABEL, PRIORITY_RANK, type TicketPriority } from "@/lib/repairs/labels";
import type { TicketDetailsNow } from "./triage-card";

/**
 * "Edit details" (repairs-spec §5.3 header, §5.1 updateTicketDetails): the
 * board corrects what was reported, where, the kind of work and the urgency.
 * Lowering an owner's urgency needs a reason they will read; moving a unit
 * problem to a shared area asks what happens to the access notes first.
 */

const GROUPS: TradeGroup[] = ["common", "systems", "outside", "specialist", "other"];

export function EditDetailsButton(props: {
  ticketId: string;
  details: TicketDetailsNow;
  units: { id: string; label: string }[];
  /** "Ada" or null when the board reported it (no reason needed then). */
  reporterFirstName: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={btnSecondary} onClick={() => setOpen(true)}>
        Edit details
      </button>
      {open ? <EditDetails {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function EditDetails(props: {
  ticketId: string;
  details: TicketDetailsNow;
  units: { id: string; label: string }[];
  reporterFirstName: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const ids = { title: useId(), where: useId(), detail: useId(), desc: useId(), access: useId(), trade: useId(), kind: useId(), reason: useId() };
  const d = props.details;
  const [v, setV] = useState({
    title: d.title,
    where: d.where,
    location_detail: d.location_detail ?? "",
    description: d.description ?? "",
    access_notes: d.access_notes ?? "",
    priority: d.priority,
    trade: d.trade ?? "",
    emergency_kind: (d.emergency_kind ?? "") as EmergencyKind | "",
  });
  const [reason, setReason] = useState("");
  const [notesChoice, setNotesChoice] = useState<"keep" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const lowering = PRIORITY_RANK[v.priority] > PRIORITY_RANK[d.priority];
  const becomingShared = d.where !== "shared" && v.where === "shared" && v.access_notes.trim() !== "";
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((x) => ({ ...x, [k]: value }));

  function save() {
    setError(null);
    start(async () => {
      const r = await updateTicketDetails(props.ticketId, {
        title: v.title,
        description: v.description || null,
        where: v.where,
        location_detail: v.location_detail || null,
        access_notes: v.access_notes || null,
        priority: v.priority,
        trade: v.trade || null,
        emergency_kind: v.emergency_kind || null,
        priorityReason: lowering && reason.trim() ? reason.trim() : null,
        accessNotesWhenShared: becomingShared ? notesChoice : null,
      });
      if ("error" in r) setError(r.error);
      else {
        router.refresh();
        props.onClose();
      }
    });
  }

  return (
    <Sheet
      open
      onClose={props.onClose}
      title="Edit details"
      footer={
        <>
          <button type="button" className={btnPrimary} disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" className={btnSecondary} onClick={props.onClose}>
            Cancel
          </button>
          {error ? <p className={errorClass}>{error}</p> : null}
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <label htmlFor={ids.title} className={labelClass}>
            What&rsquo;s wrong?
          </label>
          <input id={ids.title} maxLength={120} value={v.title} onChange={(e) => set("title", e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor={ids.where} className={labelClass}>
            Where is it?
          </label>
          <select id={ids.where} value={v.where} onChange={(e) => set("where", e.target.value)} className={inputClass}>
            <option value="shared">Shared area</option>
            {props.units.map((u) => (
              <option key={u.id} value={u.id}>
                Inside {u.label}
              </option>
            ))}
          </select>
        </div>
        {becomingShared ? (
          <fieldset>
            <legend className={labelClass}>The access notes</legend>
            <p className={hintClass}>Every owner can read a shared-area problem. Decide what happens to the access notes.</p>
            <div className="mt-2 space-y-2">
              <label className={choiceRow}>
                <input type="radio" name={`${ids.access}-share`} checked={notesChoice === "keep"} onChange={() => setNotesChoice("keep")} />
                Keep them (every owner will see them)
              </label>
              <label className={choiceRow}>
                <input type="radio" name={`${ids.access}-share`} checked={notesChoice === "clear"} onChange={() => setNotesChoice("clear")} />
                Remove them
              </label>
            </div>
          </fieldset>
        ) : null}
        <div>
          <label htmlFor={ids.detail} className={labelClass}>
            Where exactly?
          </label>
          <input id={ids.detail} maxLength={200} value={v.location_detail} onChange={(e) => set("location_detail", e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor={ids.desc} className={labelClass}>
            Details
          </label>
          <textarea id={ids.desc} rows={4} maxLength={4000} value={v.description} onChange={(e) => set("description", e.target.value)} className={textareaClass} />
        </div>
        <div>
          <label htmlFor={ids.access} className={labelClass}>
            Access and timing
          </label>
          <textarea id={ids.access} rows={2} maxLength={1000} value={v.access_notes} onChange={(e) => set("access_notes", e.target.value)} className={textareaClass} />
          <p className={hintClass}>Anyone who can see this problem can read this.</p>
        </div>
        <div>
          <label htmlFor={ids.trade} className={labelClass}>
            Kind of work
          </label>
          <select id={ids.trade} value={v.trade} onChange={(e) => set("trade", e.target.value)} className={inputClass}>
            <option value="">Not set</option>
            {GROUPS.map((g) => (
              <optgroup key={g} label={TRADE_GROUP_LABEL[g]}>
                {TRADES.filter((t) => t.group === g).map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className={labelClass}>How urgent?</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {(["low", "normal", "urgent"] as TicketPriority[]).map((p) => (
              <label key={p} className={choiceRow}>
                <input type="radio" name={`${ids.title}-priority`} checked={v.priority === p} onChange={() => set("priority", p)} />
                {PRIORITY_LABEL[p]}
              </label>
            ))}
          </div>
        </fieldset>
        {lowering && props.reporterFirstName ? (
          <div>
            <label htmlFor={ids.reason} className={labelClass}>
              Why are you lowering the urgency?
            </label>
            <textarea id={ids.reason} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={textareaClass} />
            <p className={hintClass}>{props.reporterFirstName} will see it.</p>
          </div>
        ) : null}
        <div>
          <label htmlFor={ids.kind} className={labelClass}>
            Emergency
          </label>
          <select id={ids.kind} value={v.emergency_kind} onChange={(e) => set("emergency_kind", e.target.value as EmergencyKind | "")} className={inputClass}>
            <option value="">Not an emergency</option>
            {EMERGENCY_KINDS.map((k) => (
              <option key={k} value={k}>
                {EMERGENCY_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Sheet>
  );
}
