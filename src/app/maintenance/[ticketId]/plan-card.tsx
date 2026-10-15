"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTicketPlan } from "@/app/maintenance/actions";
import { createDraft } from "@/app/contractors/actions";
import { Card } from "@/components/ui";
import { ContractorDraft } from "@/components/repairs/contractor-draft";
import { telHref } from "@/components/repairs/emergency-banner";
import { Pill } from "@/components/repairs/pills";
import { btnPrimary, errorClass, inputClass, labelClass } from "@/components/repairs/styles";
import { humanDate, moneyText } from "@/lib/repairs/format";
import { OwnerNotice } from "./owner-notice";
import type { DraftBasics, PersonOption, VendorView } from "./types";

/**
 * "Who's handling it" (repairs-spec §5.3 card 6): contractor, the board
 * member following it, the visit, the target date and the estimate, saved
 * with one setTicketPlan call that sends only what changed. An expired
 * certificate is shown, not blocked.
 */

interface Plan {
  assigned_vendor_id: string;
  assignee_person_id: string;
  scheduled_for: string;
  scheduled_window: string;
  due_on: string;
  estimated_cost: string;
}

export function PlanCard(props: {
  ticketId: string;
  canWrite: boolean;
  todayIso: string;
  plan: {
    assignedVendorId: string | null;
    assigneePersonId: string | null;
    scheduledFor: string | null;
    scheduledWindow: string | null;
    dueOn: string | null;
    estimatedCost: string | null;
  };
  vendors: VendorView[];
  people: PersonOption[];
  notice: { title: string; where: string; isUnitTicket: boolean; basics: DraftBasics | null };
}) {
  const router = useRouter();
  const ids = { vendor: "plan-contractor", visit: "plan-visit", person: useId(), window: useId(), due: useId(), estimate: useId() };
  const initial: Plan = {
    assigned_vendor_id: props.plan.assignedVendorId ?? "",
    assignee_person_id: props.plan.assigneePersonId ?? "",
    scheduled_for: props.plan.scheduledFor ?? "",
    scheduled_window: props.plan.scheduledWindow ?? "",
    due_on: props.plan.dueOn ?? "",
    estimated_cost: props.plan.estimatedCost ?? "",
  };
  const [plan, setPlan] = useState<Plan>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const [coiDraft, setCoiDraft] = useState<{ messageId: string; to: string[]; subject: string; body: string } | null>(null);

  const current = props.vendors.find((v) => v.id === props.plan.assignedVendorId) ?? null;
  const person = props.people.find((p) => p.id === props.plan.assigneePersonId) ?? null;
  const today = props.todayIso;

  if (!props.canWrite) {
    // The accountant reads the plan; nothing here is a control.
    return (
      <Card title="Who's handling it">
        <dl className="grid gap-3 text-[14px] sm:grid-cols-2">
          <Row label="Contractor">{current?.name ?? "No contractor yet"}</Row>
          <Row label="Board member following this">{person?.name ?? "Nobody"}</Row>
          <Row label="Visit">
            {props.plan.scheduledFor
              ? `${humanDate(props.plan.scheduledFor, today)}${props.plan.scheduledWindow ? `, ${props.plan.scheduledWindow}` : ""}`
              : "Not set"}
          </Row>
          <Row label="Target date">{props.plan.dueOn ? humanDate(props.plan.dueOn, today) : "Not set"}</Row>
          <Row label="Estimate">{props.plan.estimatedCost ? moneyText(props.plan.estimatedCost) : "Not set"}</Row>
        </dl>
      </Card>
    );
  }

  const set = (k: keyof Plan, v: string) => {
    setSaved(false);
    setPlan((p) => ({ ...p, [k]: v }));
  };

  function save() {
    setError(null);
    const changed: Record<string, string | null> = {};
    for (const k of Object.keys(plan) as (keyof Plan)[]) {
      if (plan[k].trim() !== initial[k].trim()) changed[k] = plan[k].trim() === "" ? null : plan[k].trim();
    }
    if (Object.keys(changed).length === 0) {
      setSaved(true);
      return;
    }
    start(async () => {
      const r = await setTicketPlan(props.ticketId, changed);
      if ("error" in r) setError(r.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  const usable = props.vendors.filter((v) => !v.archived || v.id === props.plan.assignedVendorId);
  const needsCoi = current?.compliance.some((c) => c.action === "request_coi") ?? false;

  return (
    <Card title="Who's handling it">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="space-y-5"
      >
        <div>
          <label htmlFor={ids.vendor} className={labelClass}>
            Contractor
          </label>
          <select id={ids.vendor} value={plan.assigned_vendor_id} onChange={(e) => set("assigned_vendor_id", e.target.value)} className={inputClass}>
            <option value="">No contractor yet</option>
            {usable.map((v) => (
              <option key={v.id} value={v.id} disabled={v.status === "do_not_use" || v.archived}>
                {v.name}
                {v.status === "do_not_use" ? " (do not use)" : v.archived ? " (archived)" : ""}
              </option>
            ))}
          </select>
          {current ? (
            <div className="mt-2 space-y-2">
              {current.compliance.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {current.compliance.map((c) => (
                    <Pill key={c.key} tone={c.tone === "bad" ? "bad" : "warning"}>
                      {c.text}
                    </Pill>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-4 text-[13px]">
                {current.phone ? (
                  <a href={telHref(current.phone)} className="inline-flex min-h-[44px] items-center underline underline-offset-2">
                    Call {current.phone}
                  </a>
                ) : null}
                <Link href={`/contractors/${current.id}`} className="inline-flex min-h-[44px] items-center underline underline-offset-2">
                  Profile
                </Link>
                {needsCoi && !coiDraft ? (
                  <button
                    type="button"
                    className="inline-flex min-h-[44px] items-center underline underline-offset-2"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await createDraft({ vendorId: current.id, ticketId: props.ticketId, kind: "coi_request" });
                        if ("error" in r) setError(r.error);
                        else setCoiDraft(r);
                      })
                    }
                  >
                    Ask for a certificate
                  </button>
                ) : null}
              </div>
              {coiDraft ? (
                <ContractorDraft messageId={coiDraft.messageId} to={coiDraft.to} subject={coiDraft.subject} body={coiDraft.body} title={`Certificate request to ${current.name}`} discardable />
              ) : null}
            </div>
          ) : null}
        </div>

        <div>
          <label htmlFor={ids.person} className={labelClass}>
            Board member following this
          </label>
          <select id={ids.person} value={plan.assignee_person_id} onChange={(e) => set("assignee_person_id", e.target.value)} className={inputClass}>
            <option value="">Nobody</option>
            {props.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={ids.visit} className={labelClass}>
                Visit date
              </label>
              <input id={ids.visit} type="date" value={plan.scheduled_for} onChange={(e) => set("scheduled_for", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor={ids.window} className={labelClass}>
                Time window
              </label>
              <input id={ids.window} maxLength={60} value={plan.scheduled_window} onChange={(e) => set("scheduled_window", e.target.value)} placeholder="8 to 10am" className={inputClass} />
            </div>
          </div>
          {props.plan.scheduledFor && props.notice.basics ? (
            <OwnerNotice
              ticketId={props.ticketId}
              title={props.notice.title}
              where={props.notice.where}
              visitDate={props.plan.scheduledFor}
              visitWindow={props.plan.scheduledWindow}
              contractorName={current?.name ?? null}
              isUnitTicket={props.notice.isUnitTicket}
              basics={props.notice.basics}
            />
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.due} className={labelClass}>
              Target date
            </label>
            <input id={ids.due} type="date" value={plan.due_on} onChange={(e) => set("due_on", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor={ids.estimate} className={labelClass}>
              Estimate
            </label>
            <input id={ids.estimate} inputMode="decimal" value={plan.estimated_cost} onChange={(e) => set("estimated_cost", e.target.value)} placeholder="1,250" className={inputClass} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={btnPrimary}>
            {pending ? "Saving…" : "Save"}
          </button>
          {saved && !pending ? (
            <p role="status" className="text-[13px] text-good-text">
              Saved.
            </p>
          ) : null}
        </div>
        {error ? <p className={errorClass}>{error}</p> : null}
      </form>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] font-medium text-mute">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

