"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markOwnersTold, ownerNoticeRecipients } from "@/app/maintenance/actions";
import { DraftEmail } from "@/components/email/draft-email";
import { btnPrimary, btnSecondary, choiceRow, errorClass, inputClass, labelClass } from "@/components/repairs/styles";
import { ownerNoticeDraft } from "@/lib/repairs/drafts";
import type { DraftBasics } from "./types";

/**
 * "Tell owners about the visit" (repairs-spec §5.4): a notice drafted from
 * the visit's facts. A unit problem goes to that unit's owners; a shared one
 * to every owner in Bcc, with the sender in To. Nothing is stored except the
 * note written when it's marked sent, which the reporter and owners read.
 */

type Service = "nothing" | "water" | "heat" | "power" | "gas";

export function OwnerNotice(props: {
  ticketId: string;
  title: string;
  where: string;
  visitDate: string;
  visitWindow: string | null;
  contractorName: string | null;
  isUnitTicket: boolean;
  basics: DraftBasics;
}) {
  const router = useRouter();
  const ids = { service: useId(), from: useId(), to: useId() };
  const [open, setOpen] = useState(false);
  const [service, setService] = useState<Service>("nothing");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [access, setAccess] = useState(props.isUnitTicket);
  const [draft, setDraft] = useState<{ to: string[]; bcc: string[]; subject: string; body: string; missing: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function write() {
    setError(null);
    if (service !== "nothing" && (!from.trim() || !to.trim())) {
      setError("Say from when to when it's off.");
      return;
    }
    start(async () => {
      const r = await ownerNoticeRecipients(props.ticketId);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      const d = ownerNoticeDraft(props.basics, {
        contractorName: props.contractorName,
        title: props.title,
        where: props.where,
        date: props.visitDate,
        window: props.visitWindow,
        serviceOff: service === "nothing" ? null : { what: service, from: from.trim(), to: to.trim() },
        needsUnitAccess: props.isUnitTicket && access,
      });
      setDraft({ to: r.to, bcc: r.bcc, subject: d.subject, body: d.body, missing: r.ownersWithoutEmail });
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={btnSecondary}>
        Tell owners about the visit
      </button>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-line px-4 py-3">
      {draft ? (
        <>
          <DraftEmail
            title="Notice to owners"
            to={draft.to}
            bcc={draft.bcc}
            subject={draft.subject}
            body={draft.body}
            note={draft.missing > 0 ? `${draft.missing} ${draft.missing === 1 ? "owner has" : "owners have"} no email on file. Tell them another way.` : undefined}
            onMarkSent={async () => {
              const r = await markOwnersTold(props.ticketId, props.visitDate);
              if ("error" in r) return r;
              router.refresh();
              return { ok: true as const };
            }}
          />
          <button type="button" onClick={() => setDraft(null)} className={btnSecondary}>
            Change the details
          </button>
        </>
      ) : (
        <>
          <div>
            <label htmlFor={ids.service} className={labelClass}>
              Water, heat or power off?
            </label>
            <select id={ids.service} value={service} onChange={(e) => setService(e.target.value as Service)} className={inputClass}>
              <option value="nothing">Nothing is turned off</option>
              <option value="water">Water</option>
              <option value="heat">Heat</option>
              <option value="power">Power</option>
              <option value="gas">Gas</option>
            </select>
          </div>
          {service !== "nothing" ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={ids.from} className={labelClass}>
                  From
                </label>
                <input id={ids.from} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="9am" className={inputClass} />
              </div>
              <div>
                <label htmlFor={ids.to} className={labelClass}>
                  To
                </label>
                <input id={ids.to} value={to} onChange={(e) => setTo(e.target.value)} placeholder="11am" className={inputClass} />
              </div>
            </div>
          ) : null}
          {props.isUnitTicket ? (
            <label className={choiceRow}>
              <input type="checkbox" checked={access} onChange={(e) => setAccess(e.target.checked)} className="h-5 w-5" />
              We need access to the unit
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={write} disabled={pending} className={btnPrimary}>
              {pending ? "Drafting…" : "Write the email"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={btnSecondary}>
              Cancel
            </button>
          </div>
        </>
      )}
      {error ? <p className={errorClass}>{error}</p> : null}
    </div>
  );
}
