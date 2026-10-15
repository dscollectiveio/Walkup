"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeOutTicket, recentExpensesForTicket } from "@/app/maintenance/actions";
import { QuickReview } from "@/components/repairs/quick-review";
import { Sheet } from "@/components/repairs/sheet";
import {
  btnPrimary,
  btnSecondary,
  choiceRow,
  errorClass,
  hintClass,
  inputClass,
  labelClass,
  textareaClass,
} from "@/components/repairs/styles";
import { humanDate, moneyText } from "@/lib/repairs/format";

/**
 * "Mark as fixed" (repairs-spec §5.5): what was done, the final cost, the
 * payment in the books, and the upkeep log when the problem came from an
 * upkeep job, saved in one close_out_ticket call. Then, when a contractor
 * did the work, "How did {name} do?".
 */

export interface CloseOutProps {
  ticketId: string;
  open: boolean;
  onClose: () => void;
  todayIso: string;
  /** The accepted quote's amount, else the estimate. */
  defaultCost: string | null;
  upkeepTaskName: string | null;
  /** First name of a reporter who isn't the caller and isn't on the board; null hides the Fixed/Closed choice. */
  confirmerFirstName: string | null;
}

type Expense = { id: string; paid_on: string; amount: string; memo: string | null; vendor_name: string | null };
type Done = { reviewPrompt: { vendorId: string; vendorName: string } | null; upkeepLine: string | null };

export function CloseOutDialog(props: CloseOutProps) {
  const router = useRouter();
  const ids = { note: useId(), cost: useId(), expense: useId() };
  const [note, setNote] = useState("");
  const [cost, setCost] = useState(props.defaultCost ?? "");
  const [expenseId, setExpenseId] = useState("");
  const [logUpkeep, setLogUpkeep] = useState(true);
  const [status, setStatus] = useState<"resolved" | "closed">(props.confirmerFirstName ? "resolved" : "closed");
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [pending, start] = useTransition();

  const { open, ticketId } = props;
  useEffect(() => {
    if (!open || expenses !== null) return;
    let live = true;
    void recentExpensesForTicket(ticketId).then((r) => {
      if (live) setExpenses("error" in r ? [] : r.expenses);
    });
    return () => {
      live = false;
    };
  }, [open, ticketId, expenses]);

  function finish() {
    setDone(null);
    router.refresh();
    props.onClose();
  }

  function save() {
    setError(null);
    start(async () => {
      const r = await closeOutTicket(ticketId, {
        status,
        actual_cost: cost,
        expense_id: expenseId || null,
        resolution_note: note.trim() || null,
        log_upkeep: Boolean(props.upkeepTaskName) && logUpkeep,
      });
      if ("error" in r) {
        setError(r.error);
        return;
      }
      const upkeepLine =
        r.upkeepLogged && props.upkeepTaskName
          ? `Logged "${props.upkeepTaskName}" as done.${r.nextDueOn ? ` Next due ${humanDate(r.nextDueOn, props.todayIso)}.` : ""}`
          : null;
      if (!r.reviewPrompt && !upkeepLine) finish();
      else setDone({ reviewPrompt: r.reviewPrompt, upkeepLine });
    });
  }

  if (done) {
    return (
      <Sheet
        open={open}
        onClose={finish}
        title={status === "closed" ? "Closed" : "Marked fixed"}
        footer={
          done.reviewPrompt ? undefined : (
            <button type="button" onClick={finish} className={btnPrimary}>
              Done
            </button>
          )
        }
      >
        <div className="space-y-4">
          {done.upkeepLine ? (
            <p role="status" className="text-[14px] text-good-text">
              {done.upkeepLine}
            </p>
          ) : null}
          {done.reviewPrompt ? (
            <QuickReview
              vendorId={done.reviewPrompt.vendorId}
              vendorName={done.reviewPrompt.vendorName}
              ticketId={ticketId}
              onDone={finish}
            />
          ) : null}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={props.onClose}
      title="Mark as fixed"
      footer={
        <>
          <button type="button" onClick={save} disabled={pending} className={btnPrimary}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={props.onClose} className={btnSecondary}>
            Cancel
          </button>
          {error ? <p className={errorClass}>{error}</p> : null}
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <label htmlFor={ids.note} className={labelClass}>
            What was done?
          </label>
          <textarea id={ids.note} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={textareaClass} aria-describedby={`${ids.note}-hint`} />
          <p id={`${ids.note}-hint`} className={hintClass}>
            The person who reported it sees this.
          </p>
        </div>
        <div>
          <label htmlFor={ids.cost} className={labelClass}>
            Final cost <span className="font-normal text-mute">(optional)</span>
          </label>
          <input id={ids.cost} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="480" className={inputClass} />
        </div>
        <div>
          <label htmlFor={ids.expense} className={labelClass}>
            Payment in the books
          </label>
          <select id={ids.expense} value={expenseId} onChange={(e) => setExpenseId(e.target.value)} className={inputClass} disabled={expenses === null}>
            <option value="">{expenses === null ? "Loading payments…" : "Not paid yet"}</option>
            {(expenses ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {humanDate(x.paid_on, props.todayIso)} · {moneyText(x.amount)} · {x.memo ?? x.vendor_name ?? "Payment"}
              </option>
            ))}
          </select>
        </div>
        {props.upkeepTaskName ? (
          <label className={choiceRow}>
            <input type="checkbox" checked={logUpkeep} onChange={(e) => setLogUpkeep(e.target.checked)} className="h-5 w-5" />
            Also log &ldquo;{props.upkeepTaskName}&rdquo; as done today
          </label>
        ) : null}
        {props.confirmerFirstName ? (
          <fieldset>
            <legend className={labelClass}>Fixed or closed?</legend>
            <div className="mt-2 space-y-2">
              <label className={choiceRow}>
                <input type="radio" name={`${ids.note}-status`} checked={status === "resolved"} onChange={() => setStatus("resolved")} />
                Fixed: {props.confirmerFirstName} can confirm or reopen it
              </label>
              <label className={choiceRow}>
                <input type="radio" name={`${ids.note}-status`} checked={status === "closed"} onChange={() => setStatus("closed")} />
                Closed: nothing more to do
              </label>
            </div>
          </fieldset>
        ) : null}
      </div>
    </Sheet>
  );
}
