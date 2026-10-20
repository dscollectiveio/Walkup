"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { ChevronRight } from "lucide-react";
import { humanDate, moneyText } from "@/lib/repairs/format";
import { toCents } from "@/lib/money/cents";
import { beforeContractorSelected, type WorkStatus } from "@/lib/repairs/work-status";
import { tradeLabel } from "@/lib/contractors/trades";
import {
  assignProblemContractor,
  linkProblemPayments,
  loadProblemPanel,
  saveProblemPlan,
  type ProblemPanelData,
} from "./problem-actions";

const field =
  "block min-h-[36px] w-full rounded-md border border-line-strong bg-paper px-2.5 text-[16px] text-ink sm:text-[13px] disabled:opacity-60";
const label = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-mute";
const btn =
  "inline-flex min-h-[34px] items-center justify-center whitespace-nowrap rounded-md bg-ink px-3.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-60";
const btnQuiet =
  "inline-flex min-h-[34px] items-center justify-center whitespace-nowrap rounded-md border border-line-strong bg-paper px-3.5 text-[12px] font-medium text-ink hover:bg-fill disabled:opacity-60";

/**
 * One line of the Problems list with a chevron that opens a panel under it: the
 * things you do to a problem without leaving the list. The line itself is
 * rendered on the server and passed in as children.
 */
export function ExpandableRow({
  ticketId,
  reference,
  title,
  workStatus,
  todayIso,
  canExpand,
  children,
}: {
  ticketId: string;
  reference: number;
  title: string;
  workStatus: WorkStatus;
  todayIso: string;
  canExpand: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ProblemPanelData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [, startLoad] = useTransition();
  const panelId = useId();

  // After a save, read the panel's data again so the contractor's payments, the linked count and the
  // dates match what is stored. The new data replaces the old and the panel starts clean from it.
  function reload(note: string) {
    startLoad(async () => {
      const r = await loadProblemPanel(ticketId);
      if ("error" in r) return;
      setData(r);
      setFlash(note);
      setVersion((v) => v + 1);
    });
  }

  // Load when the board first opens the panel (from the click, never from render).
  function toggle() {
    const opening = !open;
    setOpen(opening);
    if (opening && !data && !loading) {
      setLoading(true);
      setLoadError(null);
      startLoad(async () => {
        const r = await loadProblemPanel(ticketId);
        if ("error" in r) setLoadError(r.error);
        else setData(r);
        setLoading(false);
      });
    }
  }

  return (
    <li className="-mx-5 px-5 py-3">
      <div className="flex items-start gap-2">
        {canExpand ? (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${open ? "Collapse" : "Expand"} problem #${reference}: ${title}`}
            title={open ? "Collapse" : "More options"}
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line-strong bg-paper text-ink hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
          >
            <ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" className={`motion-safe:transition-transform ${open ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="w-6 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {canExpand && open ? (
        <div id={panelId} className="relative mt-3 ml-8 bg-paper">
          <ProblemPanel key={version} ticketId={ticketId} data={data} loading={loading} loadError={loadError} workStatus={workStatus} todayIso={todayIso} flash={flash} onSaved={reload} />
        </div>
      ) : null}
    </li>
  );
}

function ProblemPanel({
  ticketId,
  data,
  loading,
  loadError,
  workStatus,
  todayIso,
  flash,
  onSaved,
}: {
  ticketId: string;
  data: ProblemPanelData | null;
  loading: boolean;
  loadError: string | null;
  workStatus: WorkStatus;
  todayIso: string;
  flash: string | null;
  onSaved: (note: string) => void;
}) {
  const router = useRouter();
  if (loading || (!data && !loadError)) return <p className="rounded-lg border border-line bg-fill/40 px-4 py-3 text-[13px] text-mute">Loading…</p>;
  if (loadError || !data) {
    return <p role="alert" className="rounded-lg border border-bad-line bg-bad-tint px-4 py-3 text-[13px] text-bad-text">{loadError ?? "Couldn't load that."}</p>;
  }
  return <PanelBody ticketId={ticketId} data={data} workStatus={workStatus} todayIso={todayIso} flash={flash} refresh={(note) => { router.refresh(); onSaved(note); }} />;
}

/** Dollars with cents only when needed, from a count of cents: 125000 -> "1250", 125050 -> "1250.50". */
function centsToText(c: number): string {
  return c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2);
}

function PanelBody({
  ticketId,
  data,
  workStatus,
  todayIso,
  flash,
  refresh,
}: {
  ticketId: string;
  data: ProblemPanelData;
  workStatus: WorkStatus;
  todayIso: string;
  flash: string | null;
  refresh: (note: string) => void;
}) {
  const ids = { vendor: useId(), visit: useId(), due: useId(), est: useId(), pay: useId(), cost: useId() };
  const [vendorId, setVendorId] = useState(data.assignedVendorId ?? "");
  const [scheduled, setScheduled] = useState(data.scheduledFor ?? "");
  const [due, setDue] = useState(data.dueOn ?? "");
  const [estimate, setEstimate] = useState(data.estimatedCost ?? "");
  const [picked, setPicked] = useState<string[]>(data.linkedIds);
  const [cost, setCost] = useState(data.actualCost ?? "");
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(flash ? { text: flash, bad: false } : null);
  // What is saved, so "unsaved changes" is measured against it and clears after a save.
  const [base, setBase] = useState({
    vendor: data.assignedVendorId ?? "",
    scheduled: data.scheduledFor ?? "",
    due: data.dueOn ?? "",
    estimate: data.estimatedCost ?? "",
    linked: data.linkedIds,
    cost: data.actualCost ?? "",
  });
  const [pending, start] = useTransition();

  const paid = workStatus === "completed_paid";

  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const vendorChanged = vendorId !== base.vendor;
  const planChanged = scheduled !== base.scheduled || due !== base.due || estimate !== base.estimate;
  const paymentsChanged = (paid && !sameSet(picked, base.linked)) || cost !== base.cost;
  const dirty = vendorChanged || planChanged || paymentsChanged;

  /** One Save for everything changed in the panel, in order; stops at the first problem. */
  function save() {
    start(async () => {
      setMsg(null);
      if (vendorChanged) {
        const r = await assignProblemContractor(ticketId, vendorId || null, beforeContractorSelected(workStatus));
        if ("error" in r) return setMsg({ text: r.error, bad: true });
      }
      if (planChanged) {
        const r = await saveProblemPlan(ticketId, { scheduled_for: scheduled, due_on: due, estimated_cost: estimate });
        if ("error" in r) return setMsg({ text: r.error, bad: true });
      }
      if (paymentsChanged) {
        // Only a Completed - Paid line edits the list; a cost change on its own keeps what is linked.
        const r = await linkProblemPayments(ticketId, paid ? picked : base.linked, cost);
        if ("error" in r) return setMsg({ text: r.error, bad: true });
      }
      setBase({ vendor: vendorId, scheduled, due, estimate, linked: picked, cost });
      setMsg({ text: "Saved.", bad: false });
      refresh("Saved.");
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-line bg-fill/40 p-4">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <label htmlFor={ids.vendor} className="block text-[11px] font-medium uppercase tracking-wide text-mute">
              Contractor
            </label>
            <Link href="/repairs/find" className="text-[12px] font-medium text-ink underline underline-offset-2 hover:text-ink-mid">
              Find a contractor
            </Link>
          </div>
          <select
            id={ids.vendor}
            value={vendorId}
            disabled={pending}
            onChange={(e) => setVendorId(e.target.value)}
            className={field}
          >
            <option value="">No contractor yet</option>
            {data.vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.trades.length ? ` · ${tradeLabel(v.trades[0])}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.visit} className={label}>
            Visit date
          </label>
          <input id={ids.visit} type="date" value={scheduled} onChange={(e) => setScheduled(e.target.value)} min={todayIso} className={field} />
        </div>
        <div>
          <label htmlFor={ids.due} className={label}>
            Target date
          </label>
          <input id={ids.due} type="date" value={due} onChange={(e) => setDue(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor={ids.est} className={label}>
            Estimate
          </label>
          <input id={ids.est} inputMode="decimal" value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="$0" className={field} />
        </div>
        <div>
          <label htmlFor={ids.cost} className={label}>
            Final cost
          </label>
          <input id={ids.cost} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="$0" className={field} />
        </div>
        <div className="flex items-end pb-2">
          <Link
            href={`/maintenance/${ticketId}#documents`}
            className="text-[13px] font-medium text-ink underline underline-offset-2 hover:text-ink-mid"
          >
            Add documents
          </Link>
        </div>
      </div>

      <div className="border-t border-line pt-3">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-ink">Payment</p>
        {paid ? (
          <div className="mt-2 space-y-3">
            <fieldset>
              <legend className={label}>
                Payments in the books <span className="font-normal normal-case tracking-normal">(tick every payment that went to this problem)</span>
              </legend>
              {data.expenses.length === 0 ? (
                <p className="text-[13px] text-mute">No payments to choose from yet.</p>
              ) : (
                <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-md border border-line bg-paper">
                  {data.expenses.map((x) => {
                    const on = picked.includes(x.id);
                    return (
                      <li key={x.id}>
                        <label className="flex min-h-[36px] cursor-pointer items-center gap-3 px-3 py-1.5 text-[13px] hover:bg-fill/60">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => {
                              const next = on ? picked.filter((i) => i !== x.id) : [...picked, x.id];
                              setPicked(next);
                              // The final cost follows the ticked payments; it can still be edited afterwards.
                              const sum = data.expenses.filter((e) => next.includes(e.id)).reduce((t, e) => t + toCents(e.amount), 0);
                              setCost(next.length ? centsToText(sum) : "");
                            }}
                            className="h-4 w-4 accent-[var(--color-ink)]"
                          />
                          <span className="min-w-0 flex-1 truncate text-ink">
                            {humanDate(x.paid_on, todayIso)} · {x.memo ?? x.vendor_name ?? "Payment"}
                          </span>
                          <span className="figures shrink-0 text-ink">{moneyText(x.amount)}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </fieldset>
            <p className="text-[12px] text-mute">
              {picked.length === 0
                ? "Nothing ticked. The final cost above follows the payments you tick."
                : `${picked.length} payment${picked.length === 1 ? "" : "s"} ticked, ${moneyText(
                    centsToText(data.expenses.filter((e) => picked.includes(e.id)).reduce((t, e) => t + toCents(e.amount), 0)),
                  )} in all. The final cost above follows them; you can still change it.`}
            </p>
          </div>
        ) : (
          <p className="mt-1 text-[13px] text-mute">
            {data.linkedIds.length
              ? `${data.linkedIds.length} payment${data.linkedIds.length === 1 ? "" : "s"} linked. `
              : "Nothing linked yet. "}
            Set the status to 7. Completed - Paid to tie payments to this problem.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        {msg ? (
          <p role={msg.bad ? "alert" : "status"} className={`text-[12px] ${msg.bad ? "text-bad-text" : "text-good-text"}`}>
            {msg.text}
          </p>
        ) : dirty ? (
          <p className="text-[12px] text-mute">You have changes that aren&rsquo;t saved yet.</p>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Link href={`/maintenance/${ticketId}`} className={btnQuiet}>
            Open the full problem
          </Link>
          <button type="button" className={btn} disabled={pending || !dirty} onClick={save}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
