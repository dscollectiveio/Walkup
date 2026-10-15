"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { shortDate, todayIso as localToday } from "@/lib/dates";
import { formatMoney, formatPhone, telHref } from "@/lib/insurance/format";
import { deleteClaim, saveClaim, type ClaimInput } from "./claim-actions";
import { ConfirmDialog } from "./components/confirm-dialog";
import { ClaimStatusChip } from "./components/status-chip";
import { btnGhost, btnPrimary, dialogClass, errorBlock, inputClass, labelClass } from "./components/styles";

/**
 * Claims panel v2 (insurance-spec §9.4.3): the claims on a policy, each with
 * its repair, and a claim dialog (full screen on phones) for adding and
 * editing. The dialog starts with the insurer's claims number, because the
 * first thing to do after damage is report it.
 */

export interface ClaimRow {
  id: string;
  policy_id: string;
  date_of_loss: string;
  reported_on: string | null;
  claim_number: string | null;
  description: string;
  amount_claimed: string | null;
  amount_paid: string | null;
  deductible_applied: string | null;
  status: "open" | "paid" | "denied" | "withdrawn";
  closed_on: string | null;
  adjuster_name: string | null;
  adjuster_email: string | null;
  adjuster_phone: string | null;
  notes: string | null;
  ticket: { id: string; reference: number; title: string } | null;
}

const STATUS_LABEL: Record<ClaimRow["status"], string> = { open: "Open", paid: "Paid", denied: "Denied", withdrawn: "Withdrawn" };

const money = (v: string | null) => (v ? formatMoney(v, { cents: true })?.replace(/\.00$/, "") ?? v : null);

export interface ClaimFormProps {
  claim: ClaimRow | null;
  /** Fixed on a policy page; a select on /insurance/claims/new. */
  policyId: string | null;
  policies?: { id: string; label: string }[];
  tickets: { id: string; label: string }[];
  defaultTicketId?: string | null;
  defaultDescription?: string | null;
  claimsLine: { carrier: string; phone: string } | null;
  onSaved: (claimId: string) => void;
  onCancel: () => void;
  /** Rendered in the form after the fields (the claim's documents). */
  extra?: React.ReactNode;
}

/** The claim fields (§9.4.3), shared by the dialog and the /insurance/claims/new page. */
export function ClaimForm({
  claim,
  policyId,
  policies,
  tickets,
  defaultTicketId,
  defaultDescription,
  claimsLine,
  onSaved,
  onCancel,
  extra,
}: ClaimFormProps) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<ClaimRow["status"]>(claim?.status ?? "open");
  const [ticketFilter, setTicketFilter] = useState("");
  const [policy, setPolicy] = useState(claim?.policy_id ?? policyId ?? policies?.[0]?.id ?? "");
  const p = claim?.id ?? "new";
  const tel = claimsLine ? telHref(claimsLine.phone) : null;
  const shownTickets = ticketFilter.trim()
    ? tickets.filter((t) => t.label.toLowerCase().includes(ticketFilter.trim().toLowerCase()))
    : tickets;

  const field = (key: string, label: string, input: React.ReactNode, optional = true) => (
    <div>
      <label htmlFor={`claim-${p}-${key}`} className={labelClass}>
        {label} {optional ? <span className="font-normal text-mute-soft">optional</span> : null}
      </label>
      {input}
      {fieldErrors[key] ? <p className="mt-1 text-[12px] text-bad-text">{fieldErrors[key]}</p> : null}
    </div>
  );

  return (
    <form
      className="flex h-full flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const s = (k: string) => {
          const v = String(fd.get(k) ?? "").trim();
          return v === "" ? null : v;
        };
        const input: ClaimInput = {
          id: claim?.id ?? null,
          policyId: policy,
          ticketId: s("ticket_id"),
          dateOfLoss: s("date_of_loss") ?? "",
          reportedOn: s("reported_on"),
          claimNumber: s("claim_number"),
          description: s("description") ?? "",
          amountClaimed: s("amount_claimed"),
          amountPaid: status === "paid" ? s("amount_paid") : null,
          deductibleApplied: s("deductible_applied"),
          status,
          closedOn: status === "open" ? null : s("closed_on"),
          adjusterName: s("adjuster_name"),
          adjusterEmail: s("adjuster_email"),
          adjusterPhone: s("adjuster_phone"),
          notes: s("notes"),
        };
        start(async () => {
          setError(null);
          setFieldErrors({});
          const r = await saveClaim(input);
          if ("error" in r) {
            setError(r.error);
            setFieldErrors(r.fieldErrors ?? {});
          } else onSaved(r.claimId);
        });
      }}
    >
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {claimsLine && !claim ? (
          <div className="space-y-2">
            <p className="text-[13px] text-ink">
              First, report it: call {claimsLine.carrier} claims at{" "}
              {tel ? (
                <a href={tel} className="figures font-medium underline underline-offset-2">
                  {formatPhone(claimsLine.phone)}
                </a>
              ) : (
                <span className="figures">{claimsLine.phone}</span>
              )}
              .
            </p>
            {tel ? (
              <a href={tel} className={`${btnPrimary} w-full sm:hidden`}>
                Call {formatPhone(claimsLine.phone)}
              </a>
            ) : null}
            <p className="text-[13px] text-mute">Then record it here.</p>
          </div>
        ) : null}

        {!policyId && policies ? (
          <div>
            <label htmlFor={`claim-${p}-policy`} className={labelClass}>
              Policy
            </label>
            <select id={`claim-${p}-policy`} value={policy} onChange={(e) => setPolicy(e.target.value)} className={inputClass}>
              {policies.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            {fieldErrors.policyId ? <p className="mt-1 text-[12px] text-bad-text">{fieldErrors.policyId}</p> : null}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          {field(
            "dateOfLoss",
            "Date of the loss",
            <input id={`claim-${p}-dateOfLoss`} name="date_of_loss" type="date" required defaultValue={claim?.date_of_loss ?? ""} className={inputClass} />,
            false,
          )}
          {field(
            "reportedOn",
            "Reported to the insurer on",
            <input id={`claim-${p}-reportedOn`} name="reported_on" type="date" defaultValue={claim?.reported_on ?? ""} className={inputClass} />,
          )}
          {field(
            "claimNumber",
            "Claim number",
            <input id={`claim-${p}-claimNumber`} name="claim_number" defaultValue={claim?.claim_number ?? ""} className={inputClass} />,
          )}
        </div>
        {field(
          "description",
          "What happened",
          <textarea
            id={`claim-${p}-description`}
            name="description"
            required
            rows={3}
            placeholder="Water from unit 3 damaged the lobby ceiling"
            defaultValue={claim?.description ?? defaultDescription ?? ""}
            className={inputClass}
          />,
          false,
        )}
        <div>
          <label htmlFor={`claim-${p}-ticket`} className={labelClass}>
            The repair <span className="font-normal text-mute-soft">optional</span>
          </label>
          {tickets.length > 8 ? (
            <input
              type="search"
              aria-label="Filter repairs"
              placeholder="Filter by number or title"
              value={ticketFilter}
              onChange={(e) => setTicketFilter(e.target.value)}
              className={inputClass}
            />
          ) : null}
          <select
            id={`claim-${p}-ticket`}
            name="ticket_id"
            defaultValue={claim?.ticket?.id ?? defaultTicketId ?? ""}
            className={inputClass}
          >
            <option value="">None</option>
            {shownTickets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {field(
            "amountClaimed",
            "Amount claimed",
            <input id={`claim-${p}-amountClaimed`} name="amount_claimed" inputMode="decimal" defaultValue={claim?.amount_claimed ?? ""} className={`${inputClass} figures`} />,
          )}
          <div>
            <label htmlFor={`claim-${p}-status`} className={labelClass}>
              Status
            </label>
            <select id={`claim-${p}-status`} value={status} onChange={(e) => setStatus(e.target.value as ClaimRow["status"])} className={inputClass}>
              {(Object.keys(STATUS_LABEL) as ClaimRow["status"][]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          {status === "paid"
            ? field(
                "amountPaid",
                "Amount paid",
                <input id={`claim-${p}-amountPaid`} name="amount_paid" inputMode="decimal" defaultValue={claim?.amount_paid ?? ""} className={`${inputClass} figures`} />,
              )
            : null}
          {field(
            "deductibleApplied",
            "Deductible applied",
            <input
              id={`claim-${p}-deductibleApplied`}
              name="deductible_applied"
              inputMode="decimal"
              defaultValue={claim?.deductible_applied ?? ""}
              className={`${inputClass} figures`}
            />,
          )}
          {status !== "open"
            ? field(
                "closedOn",
                "Closed on",
                <input id={`claim-${p}-closedOn`} name="closed_on" type="date" defaultValue={claim?.closed_on ?? ""} className={inputClass} />,
              )
            : null}
        </div>
        <fieldset className="space-y-3">
          <legend className="text-[12px] font-medium text-ink">Adjuster</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            {field("adjusterName", "Name", <input id={`claim-${p}-adjusterName`} name="adjuster_name" defaultValue={claim?.adjuster_name ?? ""} className={inputClass} />)}
            {field(
              "adjusterEmail",
              "Email",
              <input id={`claim-${p}-adjusterEmail`} name="adjuster_email" type="email" defaultValue={claim?.adjuster_email ?? ""} className={inputClass} />,
            )}
            {field(
              "adjusterPhone",
              "Phone",
              <input id={`claim-${p}-adjusterPhone`} name="adjuster_phone" type="tel" defaultValue={claim?.adjuster_phone ?? ""} className={inputClass} />,
            )}
          </div>
        </fieldset>
        {field("notes", "Notes", <textarea id={`claim-${p}-notes`} name="notes" rows={3} defaultValue={claim?.notes ?? ""} className={inputClass} />)}
        {extra}
      </div>
      <div className="space-y-2 border-t border-line bg-paper px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {error ? <p className={errorBlock}>{error}</p> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={btnGhost} onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={pending}>
            {pending ? "Saving…" : "Save claim"}
          </button>
        </div>
      </div>
    </form>
  );
}

function ClaimDialog({
  open,
  onClose,
  ...form
}: Omit<ClaimFormProps, "onCancel" | "onSaved"> & { open: boolean; onClose: (saved: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const savedRef = useRef(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      savedRef.current = false;
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-label={form.claim ? "Edit the claim" : "Add a claim"} onClose={() => onClose(savedRef.current)} className={dialogClass}>
      {open ? (
        <ClaimForm
          {...form}
          onCancel={() => ref.current?.close()}
          onSaved={() => {
            savedRef.current = true;
            ref.current?.close();
          }}
        />
      ) : null}
    </dialog>
  );
}

export function ClaimsPanel({
  policyId,
  claims,
  tickets,
  canEdit,
  isAdmin,
  claimsLine,
  documents,
}: {
  policyId: string;
  claims: ClaimRow[];
  tickets: { id: string; label: string }[];
  canEdit: boolean;
  isAdmin: boolean;
  claimsLine: { carrier: string; phone: string } | null;
  /** Per claim: its "Photos and documents" section (EntityDocuments), rendered by the page. */
  documents?: Record<string, React.ReactNode>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ClaimRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<ClaimRow | null>(null);
  const todayIso = localToday();

  return (
    <div className="space-y-3">
      {claims.length === 0 ? (
        <p className="text-[13px] text-mute">No claims on this policy.</p>
      ) : (
        <ul className="divide-y divide-line text-[13px]">
          {claims.map((c) => (
            <li key={c.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-ink">{c.description}</div>
                  <div className="mt-0.5 text-[12px] text-mute">
                    {[
                      `Loss ${shortDate(c.date_of_loss, todayIso)}`,
                      c.claim_number ? `Claim ${c.claim_number}` : null,
                      money(c.amount_claimed) ? `Claimed ${money(c.amount_claimed)}` : null,
                      money(c.amount_paid) ? `Paid ${money(c.amount_paid)}` : null,
                      money(c.deductible_applied) ? `Deductible ${money(c.deductible_applied)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {c.ticket ? (
                    <Link href={`/maintenance/${c.ticket.id}`} className="mt-1 inline-flex min-h-[32px] items-center text-[12px] text-ink underline underline-offset-2">
                      Problem #{c.ticket.reference} {c.ticket.title}
                    </Link>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <ClaimStatusChip status={c.status} />
                  {canEdit ? (
                    <button type="button" onClick={() => setEditing(c)} className="min-h-[44px] rounded-md px-3 text-[12px] text-ink underline underline-offset-2 hover:bg-fill">
                      Edit
                    </button>
                  ) : null}
                </div>
              </div>
              {canEdit ? (
                <div className="flex flex-wrap gap-2">
                  <Link href={`/insurance/emails/new?kind=claim_report&claim=${c.id}`} className="inline-flex min-h-[44px] items-center text-[12px] text-ink underline underline-offset-2">
                    Email the agent about this claim
                  </Link>
                  {isAdmin ? (
                    <button type="button" onClick={() => setDeleting(c)} className="min-h-[44px] px-2 text-[12px] text-bad-text underline underline-offset-2">
                      Delete
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <button type="button" onClick={() => setEditing("new")} className={btnGhost}>
          Add a claim
        </button>
      ) : null}

      <ClaimDialog
        open={editing !== null}
        claim={editing === "new" ? null : editing}
        policyId={policyId}
        tickets={tickets}
        claimsLine={claimsLine}
        extra={
          editing && editing !== "new" && documents?.[editing.id] ? (
            <section className="space-y-2">
              <h3 className="text-[12px] font-medium text-ink">Photos and documents</h3>
              {documents[editing.id]}
            </section>
          ) : null
        }
        onClose={(saved) => {
          setEditing(null);
          if (saved) router.refresh();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this claim?"
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        danger
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const r = await deleteClaim(deleting.id);
          if ("error" in r) return r;
          router.refresh();
          return r;
        }}
      />
    </div>
  );
}
