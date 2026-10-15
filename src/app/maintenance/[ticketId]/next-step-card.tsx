"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  closeForOwner,
  closeOutTicket,
  dismissEmergencySuggestion,
  markEmergency,
  reopenTicket,
  setTicketStatus,
} from "@/app/maintenance/actions";
import { createDraft } from "@/app/contractors/actions";
import { ContractorDraft } from "@/components/repairs/contractor-draft";
import { telHref } from "@/components/repairs/emergency-banner";
import { Sheet } from "@/components/repairs/sheet";
import { btnLink, btnPrimary, btnSecondary, errorClass, labelClass, textareaClass } from "@/components/repairs/styles";
import { EMERGENCY_KIND_LABEL, type EmergencyKind } from "@/lib/repairs/emergency";
import { humanDate } from "@/lib/repairs/format";
import type { Stage } from "@/lib/repairs/stage";
import { useTicketDialogs } from "./ticket-dialogs";

/**
 * "What happens next" (repairs-spec §5.3 card 3): one sentence, one primary
 * button, at most two secondary links, by stage. Every action here appears
 * nowhere else on the page.
 */

export const OWNERS_FIX_NOTE =
  "Our reading of the declaration is that repairs inside a unit like this are the owner's responsibility. If it is affecting a shared pipe or another unit, reply here.";

export interface NextStepProps {
  ticketId: string;
  stage: Stage;
  canWrite: boolean;
  todayIso: string;
  isUnitTicket: boolean;
  resolvedAt: string | null;
  scheduledFor: string | null;
  scheduledWindow: string | null;
  /** "{received} of {asked}". */
  quotes: { received: number; asked: number };
  contractor: { id: string; name: string; phone: string | null; email: string | null } | null;
  reporterFirstName: string | null;
  /** The AI's possible emergency the board hasn't dismissed (and no emergency is set). */
  possibleEmergency: EmergencyKind | null;
  /** Kept when closing a fixed problem (close_out_ticket rewrites them). */
  closeKeep: { actualCost: string | null; expenseId: string | null };
}

function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function NextStepCard(props: NextStepProps) {
  const router = useRouter();
  const { askQuotes, markFixed, initialOpen } = useTicketDialogs();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [ownersFix, setOwnersFix] = useState(false);
  const [reopen, setReopen] = useState(false);
  const [goAhead, setGoAhead] = useState<{ messageId: string; to: string[]; subject: string; body: string } | null>(null);
  const today = props.todayIso;
  const name = props.contractor?.name ?? "the contractor";

  const run = (fn: () => Promise<{ ok: true } | { error: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if ("error" in r) setError(r.error);
      else router.refresh();
    });

  const tellGoAhead = () => {
    if (!props.contractor) return;
    const contractor = props.contractor;
    start(async () => {
      setError(null);
      // Without an email the draft still opens (to: []), as words for a call or a text.
      const r = await createDraft({ vendorId: contractor.id, ticketId: props.ticketId, kind: "job" });
      if ("error" in r) setError(r.error);
      else setGoAhead(r);
    });
  };

  // ?open=go-ahead from Today: start the go-ahead once.
  const started = useRef(false);
  useEffect(() => {
    if (initialOpen === "go-ahead" && props.stage === "chosen" && !started.current && props.canWrite) {
      started.current = true;
      tellGoAhead();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  const focusField = (id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ block: "center" });
    el?.focus();
  };

  let sentence: string;
  let primary: React.ReactNode = null;
  const secondary: React.ReactNode[] = [];
  const visitWindow = props.scheduledWindow ? `, ${props.scheduledWindow}` : "";

  switch (props.stage) {
    case "new":
      sentence = "Nobody is on this yet.";
      primary = (
        <button type="button" className={btnPrimary} onClick={() => askQuotes()}>
          Get quotes
        </button>
      );
      secondary.push(
        <button key="assign" type="button" className={btnLink} onClick={() => focusField("plan-contractor")}>
          Assign a contractor
        </button>,
        <Link key="find" href={`/repairs/find?ticket=${props.ticketId}`} className={btnLink}>
          Find someone for this
        </Link>,
      );
      if (props.isUnitTicket) {
        secondary.push(
          <button key="owner" type="button" className={btnLink} onClick={() => setOwnersFix(true)}>
            This is the owner&rsquo;s to fix
          </button>,
        );
      }
      break;
    case "quoting":
      sentence = `${props.quotes.received} of ${props.quotes.asked} quotes are in.`;
      primary = (
        <a href="#quotes" className={btnPrimary}>
          Compare quotes
        </a>
      );
      secondary.push(
        <button key="ask" type="button" className={btnLink} onClick={() => askQuotes()}>
          Ask someone else
        </button>,
      );
      if (props.isUnitTicket) {
        secondary.push(
          <button key="owner" type="button" className={btnLink} onClick={() => setOwnersFix(true)}>
            This is the owner&rsquo;s to fix
          </button>,
        );
      }
      break;
    case "chosen":
      sentence = `You chose ${name}. Walkup hasn't told them.`;
      primary = (
        <button type="button" className={btnPrimary} onClick={tellGoAhead} disabled={pending}>
          {pending ? "Drafting…" : `Tell ${name} to go ahead`}
        </button>
      );
      secondary.push(
        <button key="visit" type="button" className={btnLink} onClick={() => focusField("plan-visit")}>
          Set a visit date
        </button>,
      );
      break;
    case "in_progress":
      sentence = props.scheduledFor
        ? `${name} is on it.`
        : `${props.contractor ? name : "Someone"} is on it. Add the visit date so the reporter knows.`;
      primary = (
        <button type="button" className={btnPrimary} onClick={markFixed}>
          Mark fixed
        </button>
      );
      secondary.push(
        <button key="visit" type="button" className={btnLink} onClick={() => focusField("plan-visit")}>
          Set a visit date
        </button>,
      );
      break;
    case "scheduled":
      sentence = `Visit planned for ${humanDate(props.scheduledFor ?? today, today)}${visitWindow}.`;
      primary = (
        <button type="button" className={btnPrimary} onClick={markFixed}>
          Mark fixed
        </button>
      );
      break;
    case "fixed": {
      const fixedOn = props.resolvedAt ? props.resolvedAt.slice(0, 10) : today;
      const who = props.reporterFirstName ?? "The person who reported it";
      sentence = `Marked fixed ${humanDate(fixedOn, today)}. ${who} can confirm or reopen it until ${humanDate(addDays(fixedOn, 30), today)}.`;
      primary = (
        <button
          type="button"
          className={btnPrimary}
          disabled={pending}
          onClick={() =>
            run(() =>
              closeOutTicket(props.ticketId, {
                status: "closed",
                actual_cost: props.closeKeep.actualCost ?? "",
                expense_id: props.closeKeep.expenseId,
                resolution_note: null,
                log_upkeep: false,
              }),
            )
          }
        >
          {pending ? "Saving…" : "Close it"}
        </button>
      );
      secondary.push(
        <button key="reopen" type="button" className={btnLink} onClick={() => setReopen(true)}>
          Reopen
        </button>,
      );
      break;
    }
    case "closed":
    default:
      sentence = `Closed ${humanDate((props.resolvedAt ?? today).slice(0, 10), today)}.`;
      secondary.push(
        <button key="reopen" type="button" className={btnLink} onClick={() => setReopen(true)}>
          Reopen
        </button>,
      );
      break;
  }

  return (
    <section aria-labelledby="next-step-title" className="rounded-xl border border-line bg-paper px-5 py-4">
      <h2 id="next-step-title" className="eyebrow text-mute">
        What happens next
      </h2>

      {props.possibleEmergency && props.canWrite ? (
        <div className="mt-3 border-l-[3px] border-warning bg-warning-tint px-3 py-2 text-[13px] text-warning-text">
          <p>
            This may be an emergency ({EMERGENCY_KIND_LABEL[props.possibleEmergency].toLowerCase()}). Suggested by AI from the report.
          </p>
          <div className="mt-1 flex flex-wrap gap-x-4">
            <button type="button" className={btnLink} disabled={pending} onClick={() => run(() => markEmergency(props.ticketId, props.possibleEmergency))}>
              Mark as emergency
            </button>
            <button type="button" className={btnLink} disabled={pending} onClick={() => run(() => dismissEmergencySuggestion(props.ticketId))}>
              Not an emergency
            </button>
          </div>
        </div>
      ) : null}

      <p className="mt-2 text-[15px] text-ink">{sentence}</p>

      {props.canWrite ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {primary}
          {secondary.length ? <div className="flex flex-wrap gap-x-4">{secondary}</div> : null}
        </div>
      ) : null}
      {error ? <p className={`mt-2 ${errorClass}`}>{error}</p> : null}

      {goAhead ? (
        <div className="mt-4 space-y-3">
          {props.contractor && !props.contractor.email ? (
            <div className="space-y-2 rounded-lg border border-line px-4 py-3 text-[14px]">
              <p>
                {props.contractor.name} has no email on file.{" "}
                {props.contractor.phone ? (
                  <>
                    Call{" "}
                    <a href={telHref(props.contractor.phone)} className="underline underline-offset-2">
                      {props.contractor.phone}
                    </a>{" "}
                  </>
                ) : null}
                or add an email on their{" "}
                <Link href={`/contractors/${props.contractor.id}`} className="underline underline-offset-2">
                  profile
                </Link>
                .
              </p>
              <button type="button" className={btnSecondary} disabled={pending} onClick={() => run(() => setTicketStatus(props.ticketId, "in_progress"))}>
                I told them by phone
              </button>
            </div>
          ) : null}
          <ContractorDraft
            messageId={goAhead.messageId}
            to={goAhead.to}
            subject={goAhead.subject}
            body={goAhead.body}
            title={`Go-ahead to ${name}`}
            discardable
            onSent={() => setGoAhead(null)}
          />
        </div>
      ) : null}

      {ownersFix ? <OwnersFixDialog ticketId={props.ticketId} onClose={() => setOwnersFix(false)} /> : null}
      {reopen ? <ReopenDialog ticketId={props.ticketId} onClose={() => setReopen(false)} /> : null}
    </section>
  );
}

function OwnersFixDialog({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const router = useRouter();
  const id = useId();
  const [note, setNote] = useState(OWNERS_FIX_NOTE);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Sheet
      open
      onClose={onClose}
      title="Close as the owner's to fix?"
      footer={
        <>
          <button
            type="button"
            className={btnPrimary}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await closeForOwner(ticketId, note);
                if ("error" in r) setError(r.error);
                else {
                  router.refresh();
                  onClose();
                }
              })
            }
          >
            {pending ? "Saving…" : "Close and tell the owner"}
          </button>
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          {error ? <p className={errorClass}>{error}</p> : null}
        </>
      }
    >
      <label htmlFor={id} className={labelClass}>
        Note to the owner
      </label>
      <textarea id={id} rows={5} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={textareaClass} />
      <p className="mt-1 text-[12px] text-mute">The owner sees this note on the problem.</p>
    </Sheet>
  );
}

export function ReopenDialog({ ticketId, onClose, title = "Reopen this problem?" }: { ticketId: string; onClose: () => void; title?: string }) {
  const router = useRouter();
  const id = useId();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <button
            type="button"
            className={btnPrimary}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await reopenTicket(ticketId, reason);
                if ("error" in r) setError(r.error);
                else {
                  router.refresh();
                  onClose();
                }
              })
            }
          >
            {pending ? "Saving…" : "Reopen it"}
          </button>
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          {error ? <p className={errorClass}>{error}</p> : null}
        </>
      }
    >
      <label htmlFor={id} className={labelClass}>
        What&rsquo;s still wrong?
      </label>
      <textarea id={id} rows={4} maxLength={2000} required value={reason} onChange={(e) => setReason(e.target.value)} className={textareaClass} />
    </Sheet>
  );
}
