"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Pill } from "@/components/repairs/pills";
import { Sheet } from "@/components/repairs/sheet";
import { btnPrimary, btnSecondary, errorClass, hintClass, inputClass, labelClass, textareaClass } from "@/components/repairs/styles";
import { humanDate, moneyText } from "@/lib/repairs/format";
import { archiveBill, addBill, markBillPaid, restoreBill, setBillPaused, updateBill, type BillInput } from "./actions";

/**
 * Bills (repairs-spec §13.2): add and edit, mark paid (or, for autopay,
 * confirm it went through), pause, archive, and each bill's payments.
 * Walkup records what the board paid at the provider; it never pays.
 */

export interface BillRecord {
  id: string;
  name: string;
  account_id: string;
  vendor_id: string | null;
  frequency: BillInput["frequency"];
  next_due_on: string | null;
  typical_amount: string | null;
  autopay_arranged: boolean;
  autopay_note: string | null;
  notes: string | null;
  is_active: boolean;
  paused: boolean;
}

export interface BillRowView extends BillRecord {
  line: string;
  amountText: string;
  nextText: string | null;
  lastPaidText: string | null;
  /** An insurance premium bill (insurance-spec §12 R-2); `retired` when the renewal's bill has taken over. */
  policy: { href: string; text: string; retired: boolean } | null;
  payments: { id: string; paidOn: string; dueOn: string | null; amount: string | null; note: string | null; who: string | null }[];
}

type Option = { id: string; name: string };

const FREQUENCIES: { value: BillInput["frequency"]; label: string }[] = [
  { value: "monthly", label: "Every month" },
  { value: "quarterly", label: "Every 3 months" },
  { value: "semiannual", label: "Twice a year" },
  { value: "annual", label: "Once a year" },
];

export function BillForm(props: { bill: BillRecord | null; categories: Option[]; contractors: Option[]; onDone: () => void; todayIso: string }) {
  const router = useRouter();
  const fid = useId();
  const b = props.bill;
  const [form, setForm] = useState({
    name: b?.name ?? "",
    account_id: b?.account_id ?? "",
    vendor_id: b?.vendor_id ?? "",
    frequency: b?.frequency ?? ("monthly" as BillInput["frequency"]),
    next_due_on: b?.next_due_on ?? "",
    typical_amount: b?.typical_amount ?? "",
    autopay_arranged: b?.autopay_arranged ?? false,
    autopay_note: b?.autopay_note ?? "",
    notes: b?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  function save() {
    setError(null);
    start(async () => {
      const input: BillInput = {
        name: form.name,
        account_id: form.account_id,
        vendor_id: form.vendor_id || null,
        frequency: form.frequency,
        next_due_on: form.next_due_on,
        typical_amount: form.typical_amount.trim() || null,
        autopay_arranged: form.autopay_arranged,
        autopay_note: form.autopay_note.trim() || null,
        notes: form.notes.trim() || null,
      };
      const r = b ? await updateBill(b.id, input) : await addBill(input);
      if ("error" in r) setError(r.error);
      else {
        props.onDone();
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      {!b ? <p className="text-[12px] text-mute">A bill the building already pays: a utility, the insurance premium, a contract. Walkup reminds you; it never pays anything.</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${fid}-name`} className={labelClass}>
            Name
          </label>
          <input id={`${fid}-name`} value={form.name} maxLength={120} onChange={(e) => set("name", e.target.value)} placeholder="ComEd" className={inputClass} />
        </div>
        <div>
          <label htmlFor={`${fid}-account`} className={labelClass}>
            Category
          </label>
          <select id={`${fid}-account`} value={form.account_id} onChange={(e) => set("account_id", e.target.value)} className={inputClass}>
            <option value="">Choose…</option>
            {props.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${fid}-freq`} className={labelClass}>
            How often
          </label>
          <select id={`${fid}-freq`} value={form.frequency} onChange={(e) => set("frequency", e.target.value as BillInput["frequency"])} className={inputClass}>
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${fid}-due`} className={labelClass}>
            Next due
          </label>
          <input id={`${fid}-due`} type="date" value={form.next_due_on} onChange={(e) => set("next_due_on", e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`${fid}-amount`} className={labelClass}>
            Usual amount (optional)
          </label>
          <input
            id={`${fid}-amount`}
            inputMode="decimal"
            value={form.typical_amount}
            onChange={(e) => set("typical_amount", e.target.value)}
            placeholder="$"
            className={`figures ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor={`${fid}-vendor`} className={labelClass}>
            Paid to (optional)
          </label>
          <select id={`${fid}-vendor`} value={form.vendor_id} onChange={(e) => set("vendor_id", e.target.value)} className={inputClass}>
            <option value="">Not a saved contractor</option>
            {props.contractors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={form.autopay_arranged} onChange={(e) => set("autopay_arranged", e.target.checked)} className="h-5 w-5" />
            Autopay is set up with the provider
          </label>
          <p className={`ml-7 ${hintClass}`}>Walkup never holds bank details; this tells the next board it&rsquo;s already handled.</p>
        </div>
        {form.autopay_arranged ? (
          <div className="sm:col-span-2">
            <label htmlFor={`${fid}-autopay`} className={labelClass}>
              Autopay note
            </label>
            <input
              id={`${fid}-autopay`}
              value={form.autopay_note}
              maxLength={300}
              onChange={(e) => set("autopay_note", e.target.value)}
              placeholder="Charged to the operating account on the 1st"
              className={inputClass}
            />
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <label htmlFor={`${fid}-notes`} className={labelClass}>
            Notes
          </label>
          <textarea id={`${fid}-notes`} rows={2} value={form.notes} maxLength={2000} onChange={(e) => set("notes", e.target.value)} className={textareaClass} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2 max-sm:[&>*]:flex-1">
        <button type="button" onClick={save} disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : b ? "Save changes" : "Add the bill"}
        </button>
        <button type="button" onClick={props.onDone} className={btnSecondary}>
          Cancel
        </button>
      </div>
      {error ? <p className={errorClass}>{error}</p> : null}
    </div>
  );
}

/** "Add a bill": the form as a full-width panel below the toolbar. */
export function AddBill(props: { categories: Option[]; contractors: Option[]; todayIso: string; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={props.primary === false ? btnSecondary : btnPrimary}>
        Add a bill
      </button>
    );
  }
  return (
    <div className="w-full rounded-xl border border-line bg-paper p-4 sm:p-5">
      <BillForm bill={null} categories={props.categories} contractors={props.contractors} onDone={() => setOpen(false)} todayIso={props.todayIso} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The list, with its sheets (client, so "Marked paid" survives the refresh)
// ---------------------------------------------------------------------------

export function BillsList(props: { bills: BillRowView[]; isBoard: boolean; categories: Option[]; contractors: Option[]; todayIso: string }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [paying, setPaying] = useState<BillRowView | null>(null);
  const [editing, setEditing] = useState<BillRowView | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {notice ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-good-line bg-good-tint px-4 py-2">
          <p role="status" className="text-[14px] text-good-text">
            {notice}
          </p>
          <button type="button" onClick={() => setNotice(null)} className="inline-flex min-h-[44px] items-center text-[13px] text-ink underline underline-offset-2">
            Dismiss
          </button>
        </div>
      ) : null}
      <ul className="divide-y divide-line">
        {props.bills.map((b) => (
          <li key={b.id} className="py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium text-ink">{b.name}</span>
                  {!b.is_active ? (
                    <Pill tone="outline">Archived</Pill>
                  ) : b.paused ? (
                    <Pill tone="neutral">Paused</Pill>
                  ) : b.autopay_arranged ? (
                    <Pill tone="good">On autopay</Pill>
                  ) : (
                    <Pill tone="warning">You pay this one</Pill>
                  )}
                </div>
                <p className="text-[12px] text-mute">{b.line}</p>
                {b.policy ? (
                  <p className="text-[12px]">
                    <Link href={b.policy.href} className="text-ink underline underline-offset-2">
                      {b.policy.text}
                    </Link>
                    {b.policy.retired ? <span className="text-mute"> · {RETIRED}</span> : null}
                  </p>
                ) : null}
                {b.autopay_note || b.notes ? <p className="text-[12px] text-mute-soft">{[b.autopay_note, b.notes].filter(Boolean).join(" · ")}</p> : null}
              </div>
              <div className="shrink-0 space-y-0.5 text-[12px] text-mute sm:text-right">
                <p className="figures text-[14px] text-ink">{b.amountText}</p>
                {b.nextText ? <p>{b.nextText}</p> : null}
                {b.lastPaidText ? <p>{b.lastPaidText}</p> : null}
              </div>
            </div>
            {props.isBoard ? (
              <div className="mt-2 flex flex-wrap gap-2 max-sm:[&>*]:flex-1">
                {b.is_active && !b.paused ? (
                  <button
                    type="button"
                    onClick={() => {
                      setNotice(null);
                      setPaying(b);
                    }}
                    className={b.autopay_arranged ? btnSecondary : btnPrimary}
                  >
                    {b.autopay_arranged ? "Confirm it went through" : "Mark paid"}
                  </button>
                ) : null}
                <button type="button" onClick={() => setEditing(b)} className={btnSecondary}>
                  Edit
                </button>
                <BillMore bill={b} historyOpen={historyFor === b.id} onHistory={() => setHistoryFor(historyFor === b.id ? null : b.id)} />
              </div>
            ) : (
              <button
                type="button"
                aria-expanded={historyFor === b.id}
                onClick={() => setHistoryFor(historyFor === b.id ? null : b.id)}
                className="mt-1 inline-flex min-h-[44px] items-center text-[13px] text-ink underline underline-offset-2"
              >
                Payment history
              </button>
            )}
            {historyFor === b.id ? <PaymentHistory bill={b} todayIso={props.todayIso} /> : null}
          </li>
        ))}
      </ul>

      {paying ? (
        <MarkPaidSheet
          key={paying.id}
          bill={paying}
          todayIso={props.todayIso}
          onClose={() => setPaying(null)}
          onPaid={(msg) => {
            setPaying(null);
            setNotice(msg);
          }}
        />
      ) : null}
      {editing ? (
        <Sheet open onClose={() => setEditing(null)} wide title={`Edit ${editing.name}`}>
          <BillForm bill={editing} categories={props.categories} contractors={props.contractors} onDone={() => setEditing(null)} todayIso={props.todayIso} />
        </Sheet>
      ) : null}
    </div>
  );
}

function PaymentHistory({ bill, todayIso }: { bill: BillRowView; todayIso: string }) {
  return (
    <div className="mt-2 rounded-lg border border-line bg-fill/40 px-4 py-3">
      <p className="text-[12px] font-medium text-ink">Payment history</p>
      {bill.payments.length === 0 ? (
        <p className="mt-1 text-[13px] text-mute">No payments marked yet.</p>
      ) : (
        <ul className="mt-1 divide-y divide-line text-[13px]">
          {bill.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
              <span className="text-ink">
                Paid {humanDate(p.paidOn, todayIso)}
                <span className="text-mute">
                  {p.dueOn ? ` · covering due ${humanDate(p.dueOn, todayIso)}` : ""}
                  {p.who ? ` · ${p.who}` : ""}
                  {p.note ? ` · ${p.note}` : ""}
                </span>
              </span>
              {p.amount ? <span className="figures text-ink">{moneyText(p.amount)}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MarkPaidSheet(props: { bill: BillRowView; todayIso: string; onClose: () => void; onPaid: (message: string) => void }) {
  const router = useRouter();
  const fid = useId();
  const b = props.bill;
  const [dueOn, setDueOn] = useState(b.next_due_on);
  const [paidOn, setPaidOn] = useState(props.todayIso);
  const [amount, setAmount] = useState(b.typical_amount ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const r = await markBillPaid(b.id, { due_on: dueOn, paid_on: paidOn, amount: amount.trim() || null, note: note.trim() || null });
      if ("error" in r) {
        setError(r.error);
        // Already marked (another click or board member): show the bill's current due date.
        if ("nextDueOn" in r && r.nextDueOn !== undefined) setDueOn(r.nextDueOn);
        router.refresh();
        return;
      }
      props.onPaid(
        r.nextDueOn
          ? `${b.name}: marked paid. Next due ${humanDate(r.nextDueOn, props.todayIso)}.`
          : b.policy
            ? `${b.name}: marked paid. ${RETIRED}`
            : `${b.name}: marked paid. Nothing further is due on this bill.`,
      );
      router.refresh();
    });
  }

  return (
    <Sheet
      open
      onClose={props.onClose}
      title={dueOn ? `Paid the bill due ${humanDate(dueOn, props.todayIso)}` : `Paid ${b.name}`}
      description={b.autopay_arranged ? "Autopay is set up with the provider. Confirm the charge went through." : undefined}
      footer={
        <>
          <button type="button" onClick={save} disabled={pending || !paidOn} className={btnPrimary}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={props.onClose} className={btnSecondary}>
            Cancel
          </button>
          {error ? <p className={`w-full ${errorClass}`}>{error}</p> : null}
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor={`${fid}-paid`} className={labelClass}>
            Paid on
          </label>
          <input id={`${fid}-paid`} type="date" value={paidOn} max={props.todayIso} onChange={(e) => setPaidOn(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`${fid}-amount`} className={labelClass}>
            Amount
          </label>
          <input id={`${fid}-amount`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$" className={`figures ${inputClass}`} />
        </div>
        <div>
          <label htmlFor={`${fid}-note`} className={labelClass}>
            Note (optional)
          </label>
          <input id={`${fid}-note`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </div>
      </div>
    </Sheet>
  );
}

/** A premium bill retired by the renewal (insurance_premium_bill_advance returned null). */
const RETIRED = "Last payment for this policy. The renewal has its own bill.";

const menuItem = "flex min-h-[44px] w-full items-center rounded-md px-3 text-left text-[13px] text-ink hover:bg-fill";

function BillMore({ bill, historyOpen, onHistory }: { bill: BillRowView; historyOpen: boolean; onHistory: () => void }) {
  const router = useRouter();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true } | { error: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if ("error" in r) setError(r.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)} className={`${btnSecondary} w-full gap-1`}>
        More <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div id={menuId} className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-line bg-paper p-1 shadow-lg">
          {bill.is_active ? (
            <button type="button" disabled={pending} onClick={() => run(() => setBillPaused(bill.id, !bill.paused))} className={menuItem}>
              {bill.paused ? "Resume" : "Pause"}
            </button>
          ) : null}
          <button
            type="button"
            aria-expanded={historyOpen}
            onClick={() => {
              setOpen(false);
              onHistory();
            }}
            className={menuItem}
          >
            Payment history
          </button>
          <button type="button" disabled={pending} onClick={() => run(() => (bill.is_active ? archiveBill(bill.id) : restoreBill(bill.id)))} className={menuItem}>
            {bill.is_active ? "Archive" : "Restore"}
          </button>
          {error ? <p className={`px-3 py-2 ${errorClass}`}>{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
