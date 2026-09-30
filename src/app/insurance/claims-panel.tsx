"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { addClaim, updateClaim } from "./actions";

export interface ClaimRow {
  id: string;
  date_of_loss: string;
  claim_number: string | null;
  description: string;
  amount_claimed: number | null;
  amount_paid: number | null;
  status: string;
  ticket: { id: string; reference: number; title: string } | null;
}

const STATUS_LABEL: Record<string, string> = { open: "Open", paid: "Paid", denied: "Denied", withdrawn: "Withdrawn" };
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const inputClass = "mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink";

function ClaimStatus({ claim }: { claim: ClaimRow }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <label className="sr-only" htmlFor={`claim-status-${claim.id}`}>Claim status</label>
      <select
        id={`claim-status-${claim.id}`}
        defaultValue={claim.status}
        disabled={pending}
        onChange={(e) => {
          const status = e.target.value;
          let paid = claim.amount_paid;
          if (status === "paid") {
            const raw = window.prompt("How much did the insurer pay?", claim.amount_paid?.toString() ?? "");
            if (raw === null) {
              e.target.value = claim.status;
              return;
            }
            paid = raw.trim() === "" ? null : Number(raw.replace(/[$,]/g, ""));
          }
          start(async () => {
            setError(null);
            const r = await updateClaim(claim.id, status, paid);
            if (r.error) setError(r.error);
          });
        }}
        className="min-h-[36px] rounded-md border border-line-strong bg-paper px-2 text-[12px] text-ink"
      >
        {Object.entries(STATUS_LABEL).map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      {error ? <span className="text-[11px] text-bad-text">{error}</span> : null}
    </span>
  );
}

export function ClaimsPanel({
  policyId,
  claims,
  tickets,
  canEdit,
}: {
  policyId: string;
  claims: ClaimRow[];
  tickets: { id: string; label: string }[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addClaim, null);
  const [prev, setPrev] = useState(state);
  if (state !== prev) {
    setPrev(state);
    if (state?.ok) setOpen(false);
  }

  return (
    <div className="space-y-3">
      {claims.length === 0 ? (
        <p className="text-[13px] text-mute">No claims on this policy.</p>
      ) : (
        <ul className="divide-y divide-line text-[13px]">
          {claims.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="text-ink">{c.description}</div>
                <div className="mt-0.5 text-[12px] text-mute">
                  Loss on {c.date_of_loss}
                  {c.claim_number ? ` · claim ${c.claim_number}` : ""}
                  {c.amount_claimed !== null ? ` · claimed ${money(c.amount_claimed)}` : ""}
                  {c.amount_paid !== null ? ` · paid ${money(c.amount_paid)}` : ""}
                  {c.ticket ? (
                    <>
                      {" · "}
                      <Link href={`/maintenance/${c.ticket.id}`} className="underline underline-offset-2">
                        #{c.ticket.reference} {c.ticket.title}
                      </Link>
                    </>
                  ) : null}
                </div>
              </div>
              {canEdit ? <ClaimStatus claim={c} /> : <span className="text-[12px] text-mute">{STATUS_LABEL[c.status]}</span>}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        open ? (
          <form action={action} className="space-y-3 rounded-lg border border-line p-4">
            <input type="hidden" name="policy_id" value={policyId} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="claim-date" className="block text-[12px] font-medium text-ink">Date of the loss</label>
                <input id="claim-date" name="date_of_loss" type="date" required className={inputClass} />
              </div>
              <div>
                <label htmlFor="claim-number" className="block text-[12px] font-medium text-ink">
                  Claim number <span className="font-normal text-mute-soft">optional</span>
                </label>
                <input id="claim-number" name="claim_number" className={inputClass} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="claim-desc" className="block text-[12px] font-medium text-ink">What happened</label>
                <input id="claim-desc" name="description" required placeholder="Water from unit 3 damaged the lobby ceiling" className={inputClass} />
              </div>
              <div>
                <label htmlFor="claim-amount" className="block text-[12px] font-medium text-ink">
                  Amount claimed <span className="font-normal text-mute-soft">optional</span>
                </label>
                <input id="claim-amount" name="amount_claimed" type="number" min="0" step="0.01" className={`figures ${inputClass}`} />
              </div>
              {tickets.length > 0 ? (
                <div>
                  <label htmlFor="claim-ticket" className="block text-[12px] font-medium text-ink">
                    The repair <span className="font-normal text-mute-soft">optional</span>
                  </label>
                  <select id="claim-ticket" name="ticket_id" defaultValue="" className={inputClass}>
                    <option value="">None</option>
                    {tickets.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
            {state?.error ? <p className="text-[12px] text-bad-text">{state.error}</p> : null}
            <div className="flex gap-2">
              <button type="submit" disabled={pending} className="min-h-[44px] rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50">
                {pending ? "Saving…" : "Save claim"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] rounded-md border border-line-strong px-4 text-[13px] text-ink hover:bg-fill">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="min-h-[44px] rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill">
            Add a claim
          </button>
        )
      ) : null}
    </div>
  );
}
