"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { setTicketPlan } from "@/app/maintenance/actions";
import { RequestQuotesDialog } from "@/app/maintenance/[ticketId]/request-quotes-dialog";
import { Sheet } from "@/components/repairs/sheet";
import { telHref } from "@/components/repairs/emergency-banner";
import { btnPrimary, btnSecondary, errorClass, inputClass, labelClass } from "@/components/repairs/styles";
import { EditVendorButton, type VendorRecord } from "../vendor-form";
import { WriteToContractor } from "../write-dialog";
import { restoreContractor } from "../vendor-actions";
import { ArchiveDialog, DeleteDialog } from "./archive-dialog";
import { mailtoLink } from "@/lib/email/mailto";

export interface OpenTicketOption {
  id: string;
  reference: number;
  title: string;
  hasContractor: boolean;
  /** This contractor already has a live quote request on it. */
  asked: boolean;
}

/**
 * The profile's header buttons (repairs-spec §10.2 item 1): call, write,
 * website, ask for a quote on an open problem, assign to a problem, edit,
 * and under "More" archive or restore and (board admins) delete.
 */
export function ProfileActions(props: {
  vendor: { id: string; name: string; phone: string | null; email: string | null; website: string | null; archived: boolean; usable: boolean };
  record: VendorRecord;
  canEdit: boolean;
  isAdmin: boolean;
  openTickets: OpenTicketOption[];
  openProblems: number;
  senderEmail: string | null;
}) {
  const v = props.vendor;
  return (
    <div className="flex flex-wrap gap-2 max-sm:[&>a]:flex-1 max-sm:[&>button]:flex-1">
      {v.phone ? (
        <a href={telHref(v.phone)} className={btnPrimary}>
          Call {v.phone}
        </a>
      ) : null}
      {props.canEdit ? (
        <WriteToContractor
          contractors={[{ id: v.id, name: v.name, email: v.email }]}
          tickets={[]}
          vendorId={v.id}
          preset={{ kind: "general" }}
          label="Email"
        />
      ) : v.email ? (
        <a href={mailtoLink(v.email)} className={btnSecondary}>
          Email
        </a>
      ) : null}
      {v.website ? (
        <a href={v.website} target="_blank" rel="noopener noreferrer" className={btnSecondary}>
          Website
        </a>
      ) : null}
      {props.canEdit && v.usable ? (
        <>
          <AskForQuote vendor={v} tickets={props.openTickets} senderEmail={props.senderEmail} />
          <AssignToProblem vendorId={v.id} tickets={props.openTickets.filter((t) => !t.hasContractor)} />
        </>
      ) : null}
      {props.canEdit ? <EditVendorButton vendor={props.record} /> : null}
      {props.canEdit ? <MoreMenu vendorId={v.id} name={v.name} archived={v.archived} isAdmin={props.isAdmin} openProblems={props.openProblems} /> : null}
    </div>
  );
}

function TicketPickSheet(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  tickets: OpenTicketOption[];
  empty: string;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  error: string | null;
  onConfirm: (ticketId: string) => void;
}) {
  const fid = useId();
  const [ticketId, setTicketId] = useState("");
  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={props.title}
      footer={
        <>
          <button type="button" disabled={!ticketId || props.pending} onClick={() => props.onConfirm(ticketId)} className={btnPrimary}>
            {props.pending ? props.pendingLabel : props.confirmLabel}
          </button>
          <button type="button" onClick={props.onClose} className={btnSecondary}>
            Cancel
          </button>
          {props.error ? <p className={errorClass}>{props.error}</p> : null}
        </>
      }
    >
      {props.tickets.length === 0 ? (
        <p className="text-[13px] text-mute">{props.empty}</p>
      ) : (
        <div>
          <label htmlFor={`${fid}-t`} className={labelClass}>
            Which problem
          </label>
          <select id={`${fid}-t`} value={ticketId} onChange={(e) => setTicketId(e.target.value)} className={inputClass}>
            <option value="">Choose…</option>
            {props.tickets.map((t) => (
              <option key={t.id} value={t.id}>
                #{t.reference} {t.title}
              </option>
            ))}
          </select>
        </div>
      )}
    </Sheet>
  );
}

/** "Ask for a quote": pick an open problem, then the same "Get quotes" dialog as the problem page, with them ticked. */
function AskForQuote(props: { vendor: { id: string; name: string; email: string | null; phone: string | null }; tickets: OpenTicketOption[]; senderEmail: string | null }) {
  const [picking, setPicking] = useState(false);
  const [ticket, setTicket] = useState<OpenTicketOption | null>(null);
  return (
    <>
      <button type="button" onClick={() => setPicking(true)} className={btnSecondary}>
        Ask for a quote
      </button>
      <TicketPickSheet
        open={picking}
        onClose={() => setPicking(false)}
        title={`Ask ${props.vendor.name} for a quote`}
        tickets={props.tickets}
        empty="There are no open problems to ask about."
        confirmLabel="Continue"
        pendingLabel="Continue"
        pending={false}
        error={null}
        onConfirm={(id) => {
          setTicket(props.tickets.find((t) => t.id === id) ?? null);
          setPicking(false);
        }}
      />
      {ticket ? (
        <RequestQuotesDialog
          key={ticket.id}
          ticketId={ticket.id}
          trade={null}
          candidates={[{ vendorId: props.vendor.id, name: props.vendor.name, email: props.vendor.email, phone: props.vendor.phone, tradeMatch: true, why: [] }]}
          alreadyAsked={ticket.asked ? [props.vendor.id] : []}
          photos={[]}
          senderEmail={props.senderEmail}
          preselected={[props.vendor.id]}
          open
          onClose={() => setTicket(null)}
        />
      ) : null}
    </>
  );
}

function AssignToProblem(props: { vendorId: string; tickets: OpenTicketOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnSecondary}>
        Assign to a problem
      </button>
      <TicketPickSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Assign to a problem"
        tickets={props.tickets}
        empty="Every open problem already has a contractor."
        confirmLabel="Assign"
        pendingLabel="Assigning…"
        pending={pending}
        error={error}
        onConfirm={(ticketId) =>
          start(async () => {
            setError(null);
            const r = await setTicketPlan(ticketId, { assigned_vendor_id: props.vendorId });
            if ("error" in r) setError(r.error);
            else {
              setOpen(false);
              router.push(`/maintenance/${ticketId}`);
            }
          })
        }
      />
    </>
  );
}

function MoreMenu(props: { vendorId: string; name: string; archived: boolean; isAdmin: boolean; openProblems: number }) {
  const [open, setOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [restoring, startRestore] = useTransition();
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const router = useRouter();
  const menuId = useId();
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)} className={`${btnSecondary} gap-1`}>
        More <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div id={menuId} className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-line bg-paper p-1 shadow-lg">
          {props.archived ? (
            <button
              type="button"
              disabled={restoring}
              onClick={() =>
                startRestore(async () => {
                  setRestoreError(null);
                  const r = await restoreContractor(props.vendorId);
                  if ("error" in r) setRestoreError(r.error);
                  else {
                    setOpen(false);
                    router.refresh();
                  }
                })
              }
              className="flex min-h-[44px] w-full items-center rounded-md px-3 text-left text-[13px] text-ink hover:bg-fill"
            >
              {restoring ? "Restoring…" : "Restore"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setArchiving(true);
              }}
              className="flex min-h-[44px] w-full items-center rounded-md px-3 text-left text-[13px] text-ink hover:bg-fill"
            >
              Archive
            </button>
          )}
          {props.isAdmin ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setDeleting(true);
              }}
              className="flex min-h-[44px] w-full items-center rounded-md px-3 text-left text-[13px] text-bad-text hover:bg-bad-tint"
            >
              Delete
            </button>
          ) : null}
          {restoreError ? <p className={`px-3 py-2 ${errorClass}`}>{restoreError}</p> : null}
        </div>
      ) : null}
      <ArchiveDialog vendorId={props.vendorId} name={props.name} openProblems={props.openProblems} open={archiving} onClose={() => setArchiving(false)} />
      <DeleteDialog vendorId={props.vendorId} name={props.name} open={deleting} onClose={() => setDeleting(false)} />
    </div>
  );
}
