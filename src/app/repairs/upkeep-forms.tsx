"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { createTicketFromUpkeep } from "@/app/maintenance/actions";
import { Pill } from "@/components/repairs/pills";
import { QuickReview } from "@/components/repairs/quick-review";
import { Sheet, StickyActions } from "@/components/repairs/sheet";
import { btnDanger, btnPrimary, btnSecondary, errorClass, hintClass, inputClass, labelClass, textareaClass } from "@/components/repairs/styles";
import { guessTradeFromText, TRADES } from "@/lib/contractors/trades";
import { humanDate } from "@/lib/repairs/format";
import { allowsDueMonth, cadenceWords, MONTH_NAMES, UPKEEP_TEMPLATES } from "@/lib/upkeep/schedule";
import { INTERVAL_OPTIONS, monthsHint } from "@/lib/upkeep/view";
import {
  addUpkeepTask,
  addUpkeepTemplates,
  archiveUpkeepTask,
  deleteUpkeepTask,
  markUpkeepDone,
  restoreUpkeepTask,
  updateUpkeepTask,
} from "./upkeep-actions";

/**
 * The upkeep forms (repairs-spec §12.2, §12.3): the task dialog, the usual
 * checklist, mark done (with "How did {name} do?"), and the row actions.
 * Forms open as full-width panels or sheets, never in a card header.
 */

export interface VendorOption {
  id: string;
  name: string;
}

export interface TaskForForm {
  id: string;
  name: string;
  description: string | null;
  interval_months: number;
  due_month: number | null;
  next_due_on: string;
  trade: string | null;
  vendor_id: string | null;
  /** numeric(14,2) text */
  estimated_cost: string | null;
}

// ---------------------------------------------------------------------------
// Task dialog (add and edit)
// ---------------------------------------------------------------------------

export function TaskDialog(props: { open: boolean; onClose: () => void; task: TaskForForm | null; vendors: VendorOption[]; todayIso: string }) {
  const router = useRouter();
  const fid = useId();
  const t = props.task;
  const [name, setName] = useState(t?.name ?? "");
  const [interval, setIntervalMonths] = useState(t?.interval_months ?? 12);
  const [month, setMonth] = useState<string>(t?.due_month ? String(t.due_month) : "");
  const [trade, setTrade] = useState(t?.trade ?? "");
  const [tradeTouched, setTradeTouched] = useState(Boolean(t));
  const [vendorId, setVendorId] = useState(t?.vendor_id ?? "");
  const [cost, setCost] = useState(t?.estimated_cost ?? "");
  const [description, setDescription] = useState(t?.description ?? "");
  const [lastDone, setLastDone] = useState("");
  const [nextDue, setNextDue] = useState(t?.next_due_on ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const monthly = !allowsDueMonth(interval);
  const hint = monthsHint(interval, month ? Number(month) : null);

  function onName(v: string) {
    setName(v);
    // The kind of work follows the name until someone picks one.
    if (!tradeTouched) setTrade(guessTradeFromText(v) ?? "");
  }

  function save() {
    setError(null);
    start(async () => {
      const input = {
        name,
        description: description.trim() || null,
        interval_months: interval,
        due_month: monthly || !month ? null : Number(month),
        trade: trade || null,
        vendor_id: vendorId || null,
        estimated_cost: cost.trim() || null,
        next_due_on: nextDue || null,
        ...(t ? {} : { last_done_on: lastDone || null }),
      };
      const r = t ? await updateUpkeepTask(t.id, { ...input, next_due_on: nextDue && nextDue !== t.next_due_on ? nextDue : null }) : await addUpkeepTask(input);
      if ("error" in r) setError(r.error);
      else {
        props.onClose();
        router.refresh();
      }
    });
  }

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={t ? `Edit ${t.name}` : "Add a job"}
      footer={
        <>
          <button type="button" onClick={save} disabled={pending || !name.trim()} className={btnPrimary}>
            {pending ? "Saving…" : t ? "Save" : "Add"}
          </button>
          <button type="button" onClick={props.onClose} className={btnSecondary}>
            Cancel
          </button>
          {error ? <p className={errorClass}>{error}</p> : null}
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor={`${fid}-name`} className={labelClass}>
            What
          </label>
          <input id={`${fid}-name`} value={name} required maxLength={120} onChange={(e) => onName(e.target.value)} placeholder="Boiler service" className={inputClass} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${fid}-interval`} className={labelClass}>
              How often
            </label>
            <select id={`${fid}-interval`} value={interval} onChange={(e) => setIntervalMonths(Number(e.target.value))} className={inputClass}>
              {INTERVAL_OPTIONS.map((i) => (
                <option key={i.months} value={i.months}>
                  {i.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${fid}-month`} className={labelClass}>
              Usual month
            </label>
            <select
              id={`${fid}-month`}
              value={monthly ? "" : month}
              disabled={monthly}
              aria-describedby={`${fid}-month-hint`}
              onChange={(e) => setMonth(e.target.value)}
              className={inputClass}
            >
              <option value="">Any time</option>
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <p id={`${fid}-month-hint`} className={hintClass}>
              {monthly ? "Monthly jobs don't have a usual month." : (hint ?? "")}
            </p>
          </div>
          <div>
            <label htmlFor={`${fid}-trade`} className={labelClass}>
              Kind of work
            </label>
            <select
              id={`${fid}-trade`}
              value={trade}
              onChange={(e) => {
                setTradeTouched(true);
                setTrade(e.target.value);
              }}
              className={inputClass}
            >
              <option value="">Not sure</option>
              {TRADES.map((x) => (
                <option key={x.slug} value={x.slug}>
                  {x.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${fid}-vendor`} className={labelClass}>
              Who usually does it
            </label>
            <select id={`${fid}-vendor`} value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={inputClass}>
              <option value="">Not decided</option>
              {props.vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${fid}-cost`} className={labelClass}>
              About how much
            </label>
            <input id={`${fid}-cost`} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="$250" className={`figures ${inputClass}`} />
          </div>
          {t ? (
            <div>
              <label htmlFor={`${fid}-next`} className={labelClass}>
                Next due
              </label>
              <input id={`${fid}-next`} type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} className={inputClass} />
              <p className={hintClass}>Change it if the schedule is off. Marking it done sets it again.</p>
            </div>
          ) : (
            <>
              <div>
                <label htmlFor={`${fid}-last`} className={labelClass}>
                  Last done (optional)
                </label>
                <input id={`${fid}-last`} type="date" max={props.todayIso} value={lastDone} onChange={(e) => setLastDone(e.target.value)} className={inputClass} />
                <p className={hintClass}>If you know, we&rsquo;ll work out the next date from it.</p>
              </div>
              <div>
                <label htmlFor={`${fid}-next`} className={labelClass}>
                  Next due (optional)
                </label>
                <input id={`${fid}-next`} type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} className={inputClass} />
                <p className={hintClass}>Leave it empty and we&rsquo;ll work it out. If you fill it in, it wins over the last-done date.</p>
              </div>
            </>
          )}
        </div>
        <div>
          <label htmlFor={`${fid}-details`} className={labelClass}>
            Details
          </label>
          <textarea
            id={`${fid}-details`}
            rows={3}
            value={description}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Where the shut-off is, what the last contractor said…"
            className={textareaClass}
          />
        </div>
      </div>
    </Sheet>
  );
}

export function AddTaskButton({ vendors, todayIso, label = "Add a job", primary = false }: { vendors: VendorOption[]; todayIso: string; label?: string; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
        className={primary ? btnPrimary : btnSecondary}
      >
        {label}
      </button>
      <TaskDialog key={key} open={open} onClose={() => setOpen(false)} task={null} vendors={vendors} todayIso={todayIso} />
    </>
  );
}

export function EditTaskButton({ task, vendors, todayIso, className }: { task: TaskForForm; vendors: VendorOption[]; todayIso: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
        className={className ?? btnSecondary}
      >
        Edit
      </button>
      <TaskDialog key={key} open={open} onClose={() => setOpen(false)} task={task} vendors={vendors} todayIso={todayIso} />
    </>
  );
}

// ---------------------------------------------------------------------------
// The usual checklist
// ---------------------------------------------------------------------------

/** The usual checklist: common jobs ticked, "Only if your building has one" unticked. */
export function TemplatePicker({ existingNames, primary = false }: { existingNames: string[]; primary?: boolean }) {
  const router = useRouter();
  const have = new Set(existingNames.map((n) => n.toLowerCase()));
  const available = UPKEEP_TEMPLATES.filter((t) => !have.has(t.name.toLowerCase()));
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(available.filter((t) => t.defaultChecked).map((t) => t.name)));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (available.length === 0) return null;

  const common = available.filter((t) => t.defaultChecked);
  const optional = available.filter((t) => !t.defaultChecked);
  const row = (t: (typeof available)[number]) => (
    <li key={t.name}>
      <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2 has-[:checked]:border-ink">
        <input
          type="checkbox"
          checked={picked.has(t.name)}
          onChange={(e) => {
            const next = new Set(picked);
            if (e.target.checked) next.add(t.name);
            else next.delete(t.name);
            setPicked(next);
          }}
          className="mt-1 h-5 w-5"
        />
        <span>
          <span className="block text-[14px] font-medium text-ink">{t.name}</span>
          <span className="block text-[12px] text-mute">
            {cadenceWords(t.interval_months, t.due_month)} · {t.description}
          </span>
        </span>
      </label>
    </li>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={primary ? btnPrimary : btnSecondary}>
        Add from the usual checklist
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        wide
        title="The usual checklist"
        description="The jobs most small buildings do on a calendar. Untick anything that doesn't apply; you can edit each one after."
        footer={
          <>
            <button
              type="button"
              disabled={pending || picked.size === 0}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await addUpkeepTemplates([...picked]);
                  if ("error" in r) setError(r.error);
                  else {
                    setOpen(false);
                    router.refresh();
                  }
                })
              }
              className={btnPrimary}
            >
              {pending ? "Adding…" : `Add ${picked.size} ${picked.size === 1 ? "job" : "jobs"}`}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={btnSecondary}>
              Cancel
            </button>
            {error ? <p className={errorClass}>{error}</p> : null}
          </>
        }
      >
        <div className="space-y-5">
          {common.length > 0 ? <ul className="space-y-2">{common.map(row)}</ul> : null}
          {optional.length > 0 ? (
            <section>
              <h3 className="eyebrow text-mute">Only if your building has one</h3>
              <ul className="mt-2 space-y-2">{optional.map(row)}</ul>
            </section>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// Mark done
// ---------------------------------------------------------------------------

export interface DoneResult {
  taskId: string;
  taskName: string;
  nextDueOn: string;
  logId: string;
  review: { vendorId: string; vendorName: string } | null;
}

/** "Done on", "Cost", "Who did it", "Note"; an inline panel whose buttons stay in reach on a phone. */
export function MarkDonePanel(props: { task: TaskForForm; vendors: VendorOption[]; todayIso: string; onDone: (r: DoneResult) => void; onCancel: () => void }) {
  const fid = useId();
  const router = useRouter();
  const [doneOn, setDoneOn] = useState(props.todayIso);
  const [cost, setCost] = useState("");
  const usual = props.vendors.some((v) => v.id === props.task.vendor_id) ? (props.task.vendor_id ?? "") : "";
  const [vendorId, setVendorId] = useState(usual);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const r = await markUpkeepDone(props.task.id, { done_on: doneOn, cost: cost.trim() || null, vendor_id: vendorId || null, note: note.trim() || null });
      if ("error" in r) setError(r.error);
      else {
        props.onDone({ taskId: props.task.id, taskName: props.task.name, nextDueOn: r.nextDueOn, logId: r.logId, review: r.reviewPrompt });
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-line bg-fill/40">
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <p className="text-[14px] font-medium text-ink sm:col-span-2">Mark {props.task.name} done</p>
        <div>
          <label htmlFor={`${fid}-on`} className={labelClass}>
            Done on
          </label>
          <input id={`${fid}-on`} type="date" max={props.todayIso} value={doneOn} onChange={(e) => setDoneOn(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`${fid}-cost`} className={labelClass}>
            Cost (optional)
          </label>
          <input id={`${fid}-cost`} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="$" className={`figures ${inputClass}`} />
        </div>
        <div>
          <label htmlFor={`${fid}-who`} className={labelClass}>
            Who did it
          </label>
          <select id={`${fid}-who`} value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={inputClass}>
            <option value="">Not recorded</option>
            {props.vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${fid}-note`} className={labelClass}>
            Note (optional)
          </label>
          <input id={`${fid}-note`} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Anything worth remembering next time" className={inputClass} />
        </div>
      </div>
      <StickyActions>
        <button type="button" onClick={save} disabled={pending || !doneOn} className={btnPrimary}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={props.onCancel} disabled={pending} className={btnSecondary}>
          Cancel
        </button>
        {error ? <p className={`w-full ${errorClass}`}>{error}</p> : null}
      </StickyActions>
    </div>
  );
}

/** "Logged. Next due …" (stays until the next action) and, with a contractor, "How did {name} do?". */
export function DoneNotice({ result, todayIso, onClose }: { result: DoneResult; todayIso: string; onClose: () => void }) {
  const [reviewing, setReviewing] = useState(result.review !== null);
  const [reviewed, setReviewed] = useState(false);
  return (
    <div className="space-y-3 rounded-lg border border-good-line bg-good-tint px-4 py-3">
      <p role="status" className="text-[14px] text-good-text">
        {result.taskName}: logged. Next due {humanDate(result.nextDueOn, todayIso)}.
      </p>
      {reviewing && result.review ? (
        <div className="rounded-lg border border-line bg-paper p-4">
          <QuickReview
            vendorId={result.review.vendorId}
            vendorName={result.review.vendorName}
            upkeepLogId={result.logId}
            onDone={(saved) => {
              setReviewing(false);
              setReviewed(saved);
            }}
          />
        </div>
      ) : null}
      {reviewed ? <p className="text-[13px] text-good-text">Review saved.</p> : null}
      {!reviewing ? (
        <button type="button" onClick={onClose} className="inline-flex min-h-[44px] items-center text-[13px] text-ink underline underline-offset-2">
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

/** "Turn into a problem" (repairs-spec §12.4): twice, or from two devices, gives the same open problem. */
export function TurnIntoProblem({ taskId, className }: { taskId: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        className={className ?? btnSecondary}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await createTicketFromUpkeep(taskId);
            if ("error" in r) setError(r.error);
            else router.push(`/maintenance/${r.ticketId}`);
          })
        }
      >
        {pending ? "Opening…" : "Turn into a problem"}
      </button>
      {error ? <p className={errorClass}>{error}</p> : null}
    </>
  );
}

export function ArchiveTaskButton({ taskId, archived, className }: { taskId: string; archived: boolean; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        className={className ?? btnSecondary}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = archived ? await restoreUpkeepTask(taskId) : await archiveUpkeepTask(taskId);
            if ("error" in r) setError(r.error);
            else router.refresh();
          })
        }
      >
        {pending ? (archived ? "Restoring…" : "Archiving…") : archived ? "Restore" : "Archive"}
      </button>
      {error ? <p className={errorClass}>{error}</p> : null}
    </>
  );
}

/** Board admins; only a job with no history (archive keeps history). */
export function DeleteTaskButton({ taskId, name }: { taskId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={btnDanger}>
        Delete
      </button>
    );
  }
  return (
    <div className="w-full space-y-2 rounded-lg border border-bad-line bg-bad-tint px-3 py-3">
      <p className="text-[13px] text-bad-text">Delete {name} for good? This can&rsquo;t be undone.</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className={btnDanger}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await deleteUpkeepTask(taskId);
              if ("error" in r) setError(r.error);
              else router.push("/repairs?view=upkeep");
            })
          }
        >
          {pending ? "Deleting…" : "Delete"}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className={btnSecondary}>
          Keep it
        </button>
      </div>
      {error ? <p className={errorClass}>{error}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The schedule list (client, so "Logged. Next due …" survives the refresh that moves the row)
// ---------------------------------------------------------------------------

export interface ScheduleRow extends TaskForForm {
  when: { text: string; tone: "bad" | "warning" | "neutral" };
  line: string;
  openTicket: { id: string; reference: number } | null;
}

export function UpkeepSchedule(props: {
  groups: { key: string; label: string; tone: "bad" | "normal"; rows: ScheduleRow[] }[];
  isBoard: boolean;
  vendors: VendorOption[];
  todayIso: string;
}) {
  const [doneFor, setDoneFor] = useState<string | null>(null);
  const [result, setResult] = useState<DoneResult | null>(null);

  return (
    <div className="space-y-5">
      {result ? <DoneNotice key={result.logId} result={result} todayIso={props.todayIso} onClose={() => setResult(null)} /> : null}
      {props.groups.map((g) =>
        g.rows.length === 0 ? null : (
          <section key={g.key}>
            <h3 className={`text-[11px] font-medium uppercase tracking-[0.07em] ${g.tone === "bad" ? "text-bad-text" : "text-section-label"}`}>{g.label}</h3>
            <ul className="divide-y divide-line">
              {g.rows.map((t) => (
                <li key={t.id} className="py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/repairs/upkeep/${t.id}`} className="text-[14px] font-medium text-ink underline-offset-2 hover:underline">
                          {t.name}
                        </Link>
                        <Pill tone={t.when.tone === "bad" ? "bad" : t.when.tone === "warning" ? "warning" : "neutral"}>{t.when.text}</Pill>
                      </div>
                      <p className="mt-1 text-[12px] text-mute">{t.line}</p>
                      {t.description ? <p className="mt-0.5 text-[12px] text-mute-soft">{t.description}</p> : null}
                    </div>
                    {props.isBoard ? (
                      <div className="flex shrink-0 flex-wrap items-start gap-2 max-sm:[&>*]:flex-1">
                        <button
                          type="button"
                          onClick={() => {
                            setResult(null);
                            setDoneFor(doneFor === t.id ? null : t.id);
                          }}
                          className={btnPrimary}
                        >
                          Mark done
                        </button>
                        <RowMore task={t} vendors={props.vendors} todayIso={props.todayIso} />
                      </div>
                    ) : null}
                  </div>
                  {props.isBoard && doneFor === t.id ? (
                    <MarkDonePanel
                      task={t}
                      vendors={props.vendors}
                      todayIso={props.todayIso}
                      onCancel={() => setDoneFor(null)}
                      onDone={(r) => {
                        setDoneFor(null);
                        setResult(r);
                      }}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}

const menuItem = "flex min-h-[44px] w-full items-center rounded-md px-3 text-left text-[13px] text-ink hover:bg-fill";

function RowMore({ task, vendors, todayIso }: { task: ScheduleRow; vendors: VendorOption[]; todayIso: string }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)} className={`${btnSecondary} w-full gap-1`}>
        More <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div id={menuId} className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-line bg-paper p-1 shadow-lg">
          <EditTaskButton task={task} vendors={vendors} todayIso={todayIso} className={menuItem} />
          {task.openTicket ? (
            <Link href={`/maintenance/${task.openTicket.id}`} className={menuItem}>
              Open problem #{task.openTicket.reference}
            </Link>
          ) : (
            <TurnIntoProblem taskId={task.id} className={menuItem} />
          )}
          <Link href={`/repairs/find?task=${task.id}`} className={menuItem}>
            Find someone
          </Link>
          <Link href={`/repairs/upkeep/${task.id}`} className={menuItem}>
            History
          </Link>
          <ArchiveTaskButton taskId={task.id} archived={false} className={menuItem} />
        </div>
      ) : null}
    </div>
  );
}

/** The task page's "Mark done": the same panel, then "Logged. Next due …". */
export function MarkDoneButton({ task, vendors, todayIso }: { task: TaskForForm; vendors: VendorOption[]; todayIso: string }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<DoneResult | null>(null);
  return (
    <div className="w-full space-y-3">
      {!open ? (
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setOpen(true);
          }}
          className={btnPrimary}
        >
          Mark done
        </button>
      ) : (
        <MarkDonePanel
          task={task}
          vendors={vendors}
          todayIso={todayIso}
          onCancel={() => setOpen(false)}
          onDone={(r) => {
            setOpen(false);
            setResult(r);
          }}
        />
      )}
      {result ? <DoneNotice key={result.logId} result={result} todayIso={todayIso} onClose={() => setResult(null)} /> : null}
    </div>
  );
}
