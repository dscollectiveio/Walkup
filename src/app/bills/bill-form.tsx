"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Pill } from "@/components/repairs/pills";
import { Sheet } from "@/components/repairs/sheet";
import { HEADER_BUTTON } from "@/components/ui";
import { btnPrimary, btnSecondary, errorClass, hintClass, inputClass, labelClass, textareaClass } from "@/components/repairs/styles";
import { humanDate, moneyText } from "@/lib/repairs/format";
import { BILL_COLUMNS, BILL_LINES } from "./table";
import { addBill, archiveBill, deleteBill, markBillPaid, recentExpensesForBill, restoreBill, setBillPaused, updateBill, type BillInput } from "./actions";

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
  /** The notes as saved, without the paused note `notes` may have appended. Preferred when editing. */
  rawNotes?: string | null;
}

export interface BillRowView extends BillRecord {
  line: string;
  /** "Every month", "Once a year" ... for its own column. */
  frequencyText: string;
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
    notes: b?.rawNotes ?? b?.notes ?? "",
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
export function AddBill(props: { categories: Option[]; contractors: Option[]; todayIso: string; primary?: boolean; variant?: "solid" | "header" }) {
  const [open, setOpen] = useState(false);
  // "solid": a navy button in a row of buttons; the form opens in a sheet instead of replacing it.
  if (props.variant === "solid" || props.variant === "header") {
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className={props.variant === "header" ? HEADER_BUTTON : btnPrimary}>
          Add a bill
        </button>
        <Sheet open={open} onClose={() => setOpen(false)} wide title="Add a bill">
          {open ? <BillForm bill={null} categories={props.categories} contractors={props.contractors} onDone={() => setOpen(false)} todayIso={props.todayIso} /> : null}
        </Sheet>
      </>
    );
  }
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
      <div className="relative isolate">
        {BILL_LINES.map((c) => (
          <span key={c} aria-hidden="true" className={`pointer-events-none absolute inset-y-0 -z-10 hidden w-px bg-line xl:block ${c}`} />
        ))}
        {/* Every other bill gets a faint blue band, edge to edge. */}
        <ul className="divide-y divide-line [&>li:nth-child(even)]:bg-ink/[0.045]">
          {props.bills.map((b) => {
            const open = historyFor === b.id;
            return (
              <li key={b.id} className="-mx-5 px-5 py-3">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={`${open ? "Hide" : "Show"} details for ${b.name}`}
                    onClick={() => setHistoryFor(open ? null : b.id)}
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line-strong bg-paper text-ink hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
                  >
                    <ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" className={`transition-transform ${open ? "rotate-90" : ""}`} />
                  </button>
                  <div className={`flex min-w-0 flex-1 flex-col gap-2 ${BILL_COLUMNS}`}>
                    {/* Bill */}
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
                      {b.line ? <p className="text-[12px] text-mute">{b.line}</p> : null}
                    </div>
                    <div className="xl:text-center">
                      <p className="figures text-[13px] text-ink">{b.amountText}</p>
                      <p className="text-[12px] text-mute">{b.frequencyText}</p>
                    </div>
                    <p className="text-[12px] text-mute xl:text-center">{b.nextText ?? (b.is_active ? "" : "Off the schedule")}</p>
                    <p className="text-[12px] text-mute xl:text-center">{b.lastPaidText ? b.lastPaidText.replace(/^last paid /, "") : "Not paid yet"}</p>
                    {/* Status: a dropdown, like Problems */}
                    <div className="xl:text-center">
                      <BillStatusSelect bill={b} canEdit={props.isBoard} />
                    </div>
                  </div>
                </div>
                {open ? (
                  <BillQuickPanel
                    key={`${b.id}|${b.next_due_on}|${b.frequency}|${b.typical_amount}|${b.autopay_arranged}|${b.rawNotes}|${b.autopay_note}`}
                    bill={b}
                    onNotice={setNotice}
                    isBoard={props.isBoard}
                    todayIso={props.todayIso}
                    onFullEdit={() => setEditing(b)}
                    onPay={() => {
                      setNotice(null);
                      setPaying(b);
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

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

const RETIRED = "Last payment for this policy. The renewal has its own bill.";

type PayOption = { id: string; paid_on: string; amount: string; memo: string | null; vendor_name: string | null };

/**
 * Marking a bill paid starts from the transaction in the books that paid it:
 * pick it, and the date and amount follow (both can still be changed). A bill
 * can't be marked paid without one; a payment that isn't in the books yet is
 * categorized in the Bank Feed first.
 */
function MarkPaidSheet(props: { bill: BillRowView; todayIso: string; onClose: () => void; onPaid: (message: string) => void }) {
  const router = useRouter();
  const fid = useId();
  const b = props.bill;
  const [dueOn, setDueOn] = useState(b.next_due_on);
  const [paidOn, setPaidOn] = useState(props.todayIso);
  const [amount, setAmount] = useState(b.typical_amount ?? "");
  const [note, setNote] = useState("");
  const [options, setOptions] = useState<PayOption[] | null>(null);
  const [expenseId, setExpenseId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [started, setStarted] = useState(false);

  // Load the choices when the sheet first opens (a transition from render is not an effect).
  if (!started) {
    setStarted(true);
    start(async () => {
      const r = await recentExpensesForBill(b.id);
      if ("error" in r) {
        setError(r.error);
        setOptions([]);
      } else setOptions(r.expenses);
    });
  }

  function pick(id: string) {
    setExpenseId(id);
    const e = options?.find((o) => o.id === id);
    if (e) {
      setPaidOn(e.paid_on > props.todayIso ? props.todayIso : e.paid_on);
      setAmount(e.amount);
    }
  }

  function save() {
    setError(null);
    start(async () => {
      const r = await markBillPaid(b.id, { due_on: dueOn, paid_on: paidOn, amount: amount.trim() || null, note: note.trim() || null, expense_id: expenseId });
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
      description={b.autopay_arranged ? "Autopay is set up with the provider. Pick the charge in the books to confirm it went through." : "Pick the transaction in the books that paid it."}
      footer={
        <>
          <button type="button" onClick={save} disabled={pending || !paidOn || !expenseId} className={btnPrimary}>
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
          <label htmlFor={`${fid}-tx`} className={labelClass}>
            Transaction in the books
          </label>
          <select id={`${fid}-tx`} value={expenseId} onChange={(e) => pick(e.target.value)} disabled={options === null} className={inputClass}>
            <option value="">{options === null ? "Loading…" : "Choose the payment"}</option>
            {(options ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {humanDate(o.paid_on, props.todayIso)} · {moneyText(o.amount)} · {o.memo ?? o.vendor_name ?? "Payment"}
              </option>
            ))}
          </select>
          {options !== null && options.length === 0 ? (
            <p className={hintClass}>
              No payments to choose from yet. Categorize the payment in the{" "}
              <Link href="/bank-feed" className="underline underline-offset-2">
                Bank Feed
              </Link>{" "}
              first, then come back.
            </p>
          ) : (
            <p className={hintClass}>
              Not here? Categorize the payment in the{" "}
              <Link href="/bank-feed" className="underline underline-offset-2">
                Bank Feed
              </Link>{" "}
              and it will be.
            </p>
          )}
        </div>
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

/**
 * What opens under a bill: the short version (amount, how often, next due,
 * autopay, notes) that the board can change right here, a link to the full
 * form for everything else (name, category, who it is paid to), and the
 * payment history. Everyone else reads the same facts.
 */
function BillQuickPanel({ bill, isBoard, todayIso, onFullEdit, onPay, onNotice }: { bill: BillRowView; isBoard: boolean; todayIso: string; onFullEdit: () => void; onPay: () => void; onNotice: (message: string) => void }) {
  const router = useRouter();
  const fid = useId();
  const start0 = {
    amount: bill.typical_amount ?? "",
    frequency: bill.frequency,
    due: bill.next_due_on ?? "",
    autopay: bill.autopay_arranged,
    autopayNote: bill.autopay_note ?? "",
    notes: bill.rawNotes ?? "",
  };
  const [saved, setSaved] = useState(start0);
  const [f, setF] = useState(start0);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [pending, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const dirty = (Object.keys(f) as (keyof typeof f)[]).some((k) => f[k] !== saved[k]);
  const field =
    "block min-h-[36px] w-full rounded-md border border-line-strong bg-paper px-2.5 text-[16px] text-ink sm:text-[13px] disabled:opacity-60";
  const lab = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-mute";

  function remove() {
    if (!window.confirm(`Delete "${bill.name}"? A bill with payments recorded is archived instead, so its history is kept.`)) return;
    setMsg(null);
    startDelete(async () => {
      const r = await deleteBill(bill.id);
      if ("error" in r) setMsg({ text: r.error, bad: true });
      else {
        // The row leaves this list on refresh, so the message goes to the list-level notice.
        onNotice(r.archivedInstead ? `${bill.name}: it has payment history, so it was archived instead of deleted.` : `${bill.name}: deleted.`);
        router.refresh();
      }
    });
  }

  function save() {
    setMsg(null);
    startSave(async () => {
      const r = await updateBill(bill.id, {
        name: bill.name,
        account_id: bill.account_id,
        vendor_id: bill.vendor_id,
        frequency: f.frequency,
        next_due_on: f.due,
        typical_amount: f.amount.trim() || null,
        autopay_arranged: f.autopay,
        autopay_note: f.autopayNote.trim() || null,
        notes: f.notes.trim() || null,
      });
      if ("error" in r) setMsg({ text: r.error, bad: true });
      else {
        setSaved(f);
        setMsg({ text: "Saved.", bad: false });
        router.refresh();
      }
    });
  }

  return (
    <div className="ml-9 mt-2 space-y-3 rounded-lg border border-line bg-paper p-4">
      {bill.line || bill.policy ? (
        <p className="text-[13px] text-mute">
          {bill.line}
          {bill.policy ? (
            <>
              {bill.line ? " · " : ""}
              <Link href={bill.policy.href} className="text-ink underline underline-offset-2">
                {bill.policy.text}
              </Link>
              {bill.policy.retired ? ` · ${RETIRED}` : ""}
            </>
          ) : null}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <label htmlFor={`${fid}-amt`} className={lab}>
            Usual amount
          </label>
          <input id={`${fid}-amt`} inputMode="decimal" value={f.amount} disabled={!isBoard} onChange={(e) => set("amount", e.target.value)} placeholder="$0" className={field} />
        </div>
        <div>
          <label htmlFor={`${fid}-freq`} className={lab}>
            How often
          </label>
          <select id={`${fid}-freq`} value={f.frequency} disabled={!isBoard} onChange={(e) => set("frequency", e.target.value as BillInput["frequency"])} className={field}>
            {FREQUENCIES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${fid}-due`} className={lab}>
            Next due
          </label>
          <input id={`${fid}-due`} type="date" value={f.due} disabled={!isBoard} onChange={(e) => set("due", e.target.value)} className={field} />
        </div>
        <label className="flex min-h-[36px] cursor-pointer items-center gap-2 self-end text-[13px] text-ink">
          <input type="checkbox" checked={f.autopay} disabled={!isBoard} onChange={(e) => set("autopay", e.target.checked)} className="h-4 w-4 accent-[var(--color-ink)]" />
          On autopay at the provider
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {f.autopay ? (
          <div>
            <label htmlFor={`${fid}-ap`} className={lab}>
              Autopay note
            </label>
            <input id={`${fid}-ap`} value={f.autopayNote} disabled={!isBoard} onChange={(e) => set("autopayNote", e.target.value)} placeholder="Which card or account pays it" className={field} />
          </div>
        ) : null}
        <div className={f.autopay ? "" : "md:col-span-2"}>
          <label htmlFor={`${fid}-notes`} className={lab}>
            Notes
          </label>
          <input id={`${fid}-notes`} value={f.notes} disabled={!isBoard} onChange={(e) => set("notes", e.target.value)} placeholder="Account number, who to call, anything useful" className={field} />
        </div>
      </div>

      {isBoard ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          {bill.is_active && !bill.paused ? (
            <button type="button" onClick={onPay} className="inline-flex min-h-[34px] items-center rounded-md border border-line-strong bg-paper px-3 text-[12px] font-medium text-ink hover:bg-fill">
              {bill.autopay_arranged ? "Confirm it went through" : "Mark paid"}
            </button>
          ) : null}
          <button type="button" onClick={onFullEdit} className="text-[13px] font-medium text-ink underline underline-offset-2 hover:text-ink-mid">
            Edit all details
          </button>
          <button type="button" disabled={deleting} onClick={remove} className="text-[13px] font-medium text-bad-text underline underline-offset-2 hover:brightness-75 disabled:opacity-60">
            {deleting ? "Deleting…" : "Delete bill"}
          </button>
          {msg ? (
            <p role={msg.bad ? "alert" : "status"} className={`text-[12px] ${msg.bad ? "text-bad-text" : "text-good-text"}`}>
              {msg.text}
            </p>
          ) : dirty ? (
            <p className="text-[12px] text-mute">You have changes that aren&rsquo;t saved yet.</p>
          ) : null}
          <button
            type="button"
            disabled={pending || !dirty}
            onClick={save}
            className="ml-auto inline-flex min-h-[34px] items-center justify-center rounded-md bg-ink px-4 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      ) : null}

      <PaymentHistory bill={bill} todayIso={todayIso} />
    </div>
  );
}

/**
 * The Status dropdown on a bill (Active, Paused, Archived), like the status
 * dropdown on Problems: pick one and it is set. Everyone else reads it.
 */
function BillStatusSelect({ bill, canEdit }: { bill: BillRowView; canEdit: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const current = !bill.is_active ? "archived" : bill.paused ? "paused" : "active";
  const label = { active: "Active", paused: "Paused", archived: "Archived" }[current];
  if (!canEdit) return <span className="text-[12px] text-mute">{label}</span>;

  function change(next: string) {
    if (next === current) return;
    start(async () => {
      setError(null);
      // Archived to Paused goes through Restore first; Paused or Active to Archived is one step.
      let r: { ok: true } | { error: string } = { ok: true };
      if (next === "archived") r = await archiveBill(bill.id);
      else {
        if (current === "archived") r = await restoreBill(bill.id);
        if ("ok" in r) r = await setBillPaused(bill.id, next === "paused");
      }
      if ("error" in r) setError(r.error);
      // Refresh either way: a half-done change (restored, then the pause failed) must not leave the box lying.
      router.refresh();
    });
  }
  return (
    <div>
      <label className="sr-only" htmlFor={`bill-status-${bill.id}`}>
        Status of {bill.name}
      </label>
      <select
        id={`bill-status-${bill.id}`}
        value={current}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        className="min-h-[34px] w-full rounded-md border border-line-strong bg-paper px-1.5 text-[12px] font-medium text-ink hover:bg-fill disabled:opacity-60"
      >
        <option value="active">Active</option>
        <option value="paused">Paused</option>
        <option value="archived">Archived</option>
      </select>
      {error ? (
        <p role="alert" className="mt-1 text-[12px] text-bad-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
